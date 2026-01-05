#import "OverTheAir.h"
#import <OverTheAirSpec/OverTheAirSpec.h>
#import <React/RCTBridge.h>
#import <React/RCTReloadCommand.h>
#import <React/RCTUtils.h>
#import <React/RCTRootView.h>
#import <React/RCTBundleURLProvider.h>
#import <SSZipArchive/SSZipArchive.h>

@interface OverTheAir () <NativeOverTheAirSpec>
@end

@implementation OverTheAir {
  NSUserDefaults *_userDefaults;
}

+ (NSURL *)bundleURL {
  NSArray<NSURL *> *paths = [[NSFileManager defaultManager] URLsForDirectory:NSDocumentDirectory inDomains:NSUserDomainMask];
  NSURL *documentsDirectory = paths[0];
  NSString *appVersion = [OverTheAir appVersion];
  NSURL *otaDirectory = [[documentsDirectory URLByAppendingPathComponent:@"ota"] URLByAppendingPathComponent:appVersion];
  
  if (![[NSFileManager defaultManager] fileExistsAtPath:otaDirectory.path]) {
    [[NSFileManager defaultManager] createDirectoryAtURL:otaDirectory withIntermediateDirectories:YES attributes:nil error:nil];
  }
  
  NSURL *bundleURL = [otaDirectory URLByAppendingPathComponent:@"index.ios.bundle"];
  if ([[NSFileManager defaultManager] fileExistsAtPath:bundleURL.path]) {
    return bundleURL;
  }
  return nil;
}

+ (NSString *)appVersion {
  return [[[NSBundle mainBundle] infoDictionary] objectForKey:@"CFBundleShortVersionString"] ?: @"unknown";
}

- (instancetype)init {
  if (self = [super init]) {
    _userDefaults = [NSUserDefaults standardUserDefaults];
  }
  return self;
}

- (NSString *)getBundlePath {
  NSArray<NSURL *> *paths = [[NSFileManager defaultManager] URLsForDirectory:NSDocumentDirectory inDomains:NSUserDomainMask];
  NSURL *documentsDirectory = paths[0];
  NSString *appVersion = [OverTheAir appVersion];
  NSURL *otaDirectory = [[documentsDirectory URLByAppendingPathComponent:@"ota"] URLByAppendingPathComponent:appVersion];
  
  if (![[NSFileManager defaultManager] fileExistsAtPath:otaDirectory.path]) {
    [[NSFileManager defaultManager] createDirectoryAtURL:otaDirectory withIntermediateDirectories:YES attributes:nil error:nil];
  }
  
  return [otaDirectory URLByAppendingPathComponent:@"index.ios.bundle"].path;
}

- (void)setBaseURL:(NSString *)url {
  [_userDefaults setObject:url forKey:@"OverTheAirBaseURL"];
  [_userDefaults synchronize];
}

- (void)downloadBundle:(NSString *)url
               resolve:(RCTPromiseResolveBlock)resolve
                reject:(RCTPromiseRejectBlock)reject {
  NSURL *bundleURL = [NSURL URLWithString:url];
  if (!bundleURL) {
    reject(@"INVALID_URL", @"Invalid URL provided", nil);
    return;
  }
  
  NSURLSessionConfiguration *configuration = [NSURLSessionConfiguration defaultSessionConfiguration];
  [configuration setHTTPAdditionalHeaders:@{
    @"X-App-Version": [OverTheAir appVersion],
    @"X-Platform": @"ios"
  }];
  NSURLSession *session = [NSURLSession sessionWithConfiguration:configuration];
  
  NSURLSessionDataTask *task = [session dataTaskWithURL:bundleURL completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
    if (error) {
      reject(@"DOWNLOAD_ERROR", error.localizedDescription, error);
      return;
    }
    
    NSHTTPURLResponse *httpResponse = (NSHTTPURLResponse *)response;
    if (httpResponse.statusCode < 200 || httpResponse.statusCode >= 300) {
      reject(@"HTTP_ERROR", [NSString stringWithFormat:@"HTTP %ld", (long)httpResponse.statusCode], nil);
      return;
    }
    
    BOOL isZip = [url.lowercaseString hasSuffix:@".zip"];
    NSArray<NSURL *> *paths = [[NSFileManager defaultManager] URLsForDirectory:NSDocumentDirectory inDomains:NSUserDomainMask];
    NSURL *documentsDirectory = paths[0];
    NSString *appVersion = [OverTheAir appVersion];
    NSURL *otaDirectory = [[documentsDirectory URLByAppendingPathComponent:@"ota"] URLByAppendingPathComponent:appVersion];

    if (![[NSFileManager defaultManager] fileExistsAtPath:otaDirectory.path]) {
        [[NSFileManager defaultManager] createDirectoryAtURL:otaDirectory withIntermediateDirectories:YES attributes:nil error:nil];
    }

    if (isZip) {
        NSString *tempZipPath = [NSTemporaryDirectory() stringByAppendingPathComponent:@"temp_bundle.zip"];
        [data writeToFile:tempZipPath atomically:YES];
        
        BOOL success = [SSZipArchive unzipFileAtPath:tempZipPath toDestination:otaDirectory.path];
        [[NSFileManager defaultManager] removeItemAtPath:tempZipPath error:nil];
        
        if (!success) {
            reject(@"UNZIP_ERROR", @"Failed to unzip bundle package", nil);
            return;
        }
    } else {
        NSString *bundlePath = [otaDirectory URLByAppendingPathComponent:@"index.ios.bundle"].path;
        NSError *writeError = nil;
        BOOL success = [data writeToFile:bundlePath options:NSDataWritingAtomic error:&writeError];
        
        if (!success || writeError) {
            reject(@"FILE_ERROR", writeError ? writeError.localizedDescription : @"Failed to write bundle file", writeError);
            return;
        }
    }
    
    resolve(@YES);
  }];
  
  [task resume];
}

- (void)checkForUpdates:(RCTPromiseResolveBlock)resolve
                 reject:(RCTPromiseRejectBlock)reject {
  NSString *baseURL = [_userDefaults stringForKey:@"OverTheAirBaseURL"];
  if (!baseURL) {
    reject(@"NO_BASE_URL", @"Base URL not set. Call setBaseURL first.", nil);
    return;
  }
  
  NSString *manifestURLString = [baseURL hasSuffix:@"/"] ? [baseURL stringByAppendingString:@"manifest.json"] : [NSString stringWithFormat:@"%@/%@", baseURL, @"manifest.json"];
  NSURL *manifestURL = [NSURL URLWithString:manifestURLString];
  
  NSURLSessionDataTask *task = [[NSURLSession sharedSession] dataTaskWithURL:manifestURL completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
    if (error || !data) {
      resolve([NSNull null]);
      return;
    }
    
    NSDictionary *manifest = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
    if (!manifest) {
      resolve([NSNull null]);
      return;
    }
    
    NSDictionary *platformUpdates = [manifest objectForKey:@"ios"];
    if (!platformUpdates) {
      resolve([NSNull null]);
      return;
    }
    
    NSString *appVersion = [OverTheAir appVersion];
    NSDictionary *updateInfo = [platformUpdates objectForKey:appVersion];
    if (!updateInfo) {
      resolve([NSNull null]);
      return;
    }
    
    NSString *remoteVersion = [updateInfo objectForKey:@"version"];
    NSString *versionKey = [NSString stringWithFormat:@"CurrentBundleVersion_%@", appVersion];
    NSString *localVersion = [_userDefaults stringForKey:versionKey] ?: @"";
    
    if (![remoteVersion isEqualToString:localVersion]) {
      resolve(@{
        @"url": [updateInfo objectForKey:@"url"],
        @"version": remoteVersion,
        @"isMandatory": [updateInfo objectForKey:@"isMandatory"] ?: @NO
      });
    } else {
      resolve([NSNull null]);
    }
  }];
  
  [task resume];
}

- (void)saveBundleVersion:(NSString *)version {
  NSString *appVersion = [OverTheAir appVersion];
  NSString *versionKey = [NSString stringWithFormat:@"CurrentBundleVersion_%@", appVersion];
  [_userDefaults setObject:version forKey:versionKey];
  [_userDefaults synchronize];
}

- (NSString *)getAppVersion {
  return [OverTheAir appVersion];
}

- (NSString *)getBundleVersion {
  NSString *appVersion = [OverTheAir appVersion];
  NSString *versionKey = [NSString stringWithFormat:@"CurrentBundleVersion_%@", appVersion];
  return [_userDefaults stringForKey:versionKey] ?: @"";
}

- (void)reloadBundle {
  dispatch_async(dispatch_get_main_queue(), ^{
    // Reload the React Native app
    // RCTTriggerReloadCommandListeners is available in React Native 0.60+
    RCTTriggerReloadCommandListeners(@"OverTheAir: Reloading bundle");
  });
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
    return std::make_shared<facebook::react::NativeOverTheAirSpecJSI>(params);
}

+ (NSString *)moduleName
{
  return @"OverTheAir";
}

@end
