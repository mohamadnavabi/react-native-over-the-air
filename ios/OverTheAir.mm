#import "OverTheAir.h"
#import <React/RCTBridge.h>
#import <React/RCTReloadCommand.h>
#import <React/RCTUtils.h>
#import <React/RCTRootView.h>
#import <React/RCTBundleURLProvider.h>

@implementation OverTheAir {
  NSUserDefaults *_userDefaults;
}

+ (NSURL *)bundleURL {
  NSArray<NSURL *> *paths = [[NSFileManager defaultManager] URLsForDirectory:NSDocumentDirectory inDomains:NSUserDomainMask];
  NSURL *documentsDirectory = paths[0];
  NSURL *otaDirectory = [documentsDirectory URLByAppendingPathComponent:@"ota"];
  
  if (![[NSFileManager defaultManager] fileExistsAtPath:otaDirectory.path]) {
    [[NSFileManager defaultManager] createDirectoryAtURL:otaDirectory withIntermediateDirectories:YES attributes:nil error:nil];
  }
  
  NSURL *bundleURL = [otaDirectory URLByAppendingPathComponent:@"index.ios.bundle"];
  if ([[NSFileManager defaultManager] fileExistsAtPath:bundleURL.path]) {
    return bundleURL;
  }
  return nil;
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
  NSURL *otaDirectory = [documentsDirectory URLByAppendingPathComponent:@"ota"];
  
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
    
    NSString *bundlePath = [self getBundlePath];
    NSError *writeError = nil;
    BOOL success = [data writeToFile:bundlePath options:NSDataWritingAtomic error:&writeError];
    
    if (!success || writeError) {
      reject(@"FILE_ERROR", writeError ? writeError.localizedDescription : @"Failed to write bundle file", writeError);
      return;
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
  
  NSString *bundleFileName = @"index.ios.bundle";
  NSString *bundleURLString = [baseURL hasSuffix:@"/"] 
    ? [baseURL stringByAppendingString:bundleFileName]
    : [NSString stringWithFormat:@"%@/%@", baseURL, bundleFileName];
  
  NSURL *bundleURL = [NSURL URLWithString:bundleURLString];
  if (!bundleURL) {
    resolve(@NO);
    return;
  }
  
  NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:bundleURL];
  [request setHTTPMethod:@"HEAD"];
  
  NSURLSessionConfiguration *configuration = [NSURLSessionConfiguration defaultSessionConfiguration];
  NSURLSession *session = [NSURLSession sessionWithConfiguration:configuration];
  
  NSURLSessionDataTask *task = [session dataTaskWithRequest:request completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
    if (error) {
      resolve(@NO);
      return;
    }
    
    NSHTTPURLResponse *httpResponse = (NSHTTPURLResponse *)response;
    if (httpResponse.statusCode < 200 || httpResponse.statusCode >= 300) {
      resolve(@NO);
      return;
    }
    
    NSString *localBundlePath = [self getBundlePath];
    NSFileManager *fileManager = [NSFileManager defaultManager];
    
    if (![fileManager fileExistsAtPath:localBundlePath]) {
      resolve(@YES);
      return;
    }
    
    NSDictionary *localAttributes = [fileManager attributesOfItemAtPath:localBundlePath error:nil];
    NSDate *localLastModified = [localAttributes objectForKey:NSFileModificationDate];
    unsigned long long localSize = [[localAttributes objectForKey:NSFileSize] unsignedLongLongValue];
    
    BOOL hasUpdate = NO;
    BOOL canCompare = NO;
    
    NSString *lastModifiedString = [httpResponse.allHeaderFields objectForKey:@"Last-Modified"];
    if (lastModifiedString) {
      NSDateFormatter *formatter = [[NSDateFormatter alloc] init];
      formatter.dateFormat = @"EEE, dd MMM yyyy HH:mm:ss zzz";
      formatter.locale = [[NSLocale alloc] initWithLocaleIdentifier:@"en_US_POSIX"];
      formatter.timeZone = [NSTimeZone timeZoneWithAbbreviation:@"GMT"];
      
      NSDate *remoteLastModified = [formatter dateFromString:lastModifiedString];
      if (remoteLastModified) {
        canCompare = YES;
        if ([remoteLastModified compare:localLastModified] == NSOrderedDescending) {
          hasUpdate = YES;
        }
      }
    }
    
    NSString *contentLengthString = [httpResponse.allHeaderFields objectForKey:@"Content-Length"];
    if (contentLengthString) {
      unsigned long long remoteContentLength = [contentLengthString longLongValue];
      if (remoteContentLength > 0) {
        canCompare = YES;
        if (remoteContentLength != localSize) {
          hasUpdate = YES;
        }
      }
    }
    
    // If we can't reliably compare (no headers), default to true to allow download
    // This ensures users can always try to download if bundle exists on server
    if (!canCompare) {
      hasUpdate = YES;
    }
    
    resolve(@(hasUpdate));
  }];
  
  [task resume];
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
