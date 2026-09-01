#import "OverTheAir.h"

#import <CommonCrypto/CommonDigest.h>

#include <utility>
#import <OverTheAirSpec/OverTheAirSpec.h>
#import <React/RCTReloadCommand.h>
#import <SSZipArchive/SSZipArchive.h>

static NSString *const OTAErrorDomain = @"OverTheAir";
static NSString *const OTABundleFileName = @"index.ios.bundle";
static NSString *const OTARemovalListName = @".ota-remove.json";
static NSString *const OTAPlatform = @"ios";

static NSString *const OTABaseURLKey = @"OverTheAir.baseURL";
static NSString *const OTAAllowInsecureHTTPKey = @"OverTheAir.allowInsecureHttp";
static NSString *const OTALegacyMigrationKey = @"OverTheAir.migratedFromDocuments";
static NSString *const OTACurrentVersionKeyPrefix = @"OverTheAir.currentVersion.";
static NSString *const OTAPendingVersionKeyPrefix = @"OverTheAir.pendingVersion.";
static NSString *const OTAPendingLaunchedKeyPrefix = @"OverTheAir.pendingLaunched.";

static const NSTimeInterval OTAProgressInterval = 0.1;
static const NSTimeInterval OTAManifestTimeout = 15.0;
static const NSTimeInterval OTADownloadTimeout = 120.0;

#pragma mark - Download context

/** Per-download state shared between the NSURLSession delegate callbacks. */
@interface OTADownloadContext : NSObject {
@public
  CC_SHA256_CTX _digest;
}
@property (nonatomic, strong) NSFileHandle *fileHandle;
@property (nonatomic, assign) long long receivedBytes;
@property (nonatomic, assign) long long totalBytes;
@property (nonatomic, assign) NSTimeInterval lastProgressAt;
@property (nonatomic, copy) void (^completion)(NSString *_Nullable sha256, NSError *_Nullable error);
@end

@implementation OTADownloadContext
@end

#pragma mark -

@interface OverTheAir () <NativeOverTheAirSpec, NSURLSessionDataDelegate>
@end

@implementation OverTheAir {
  facebook::react::EventEmitterCallback _eventEmitterCallback;
  NSURLSession *_session;
  OTADownloadContext *_download;
  BOOL _installing;
}

RCT_EXPORT_MODULE()

/**
 * Whether the rollback check has already run in this process. A JS-level
 * reload calls `bundleURL` again, and that must not be mistaken for a fresh
 * launch of an unconfirmed bundle.
 */
static BOOL OTADidResolvePendingLaunch = NO;

#pragma mark - Storage layout

+ (NSUserDefaults *)defaults
{
  return [NSUserDefaults standardUserDefaults];
}

+ (NSString *)appVersion
{
  NSString *version = [[NSBundle mainBundle] infoDictionary][@"CFBundleShortVersionString"];
  return version.length > 0 ? version : @"unknown";
}

/**
 * Downloaded code lives in Application Support rather than Documents: it must
 * not appear in the Files app, and it must not be restored from an iCloud
 * backup onto a device running a different build.
 */
+ (nullable NSURL *)rootDirectory
{
  NSError *error = nil;
  NSURL *appSupport = [[NSFileManager defaultManager] URLForDirectory:NSApplicationSupportDirectory
                                                             inDomain:NSUserDomainMask
                                                    appropriateForURL:nil
                                                               create:YES
                                                                error:&error];
  if (!appSupport) {
    NSLog(@"[OverTheAir] Could not locate Application Support: %@", error);
    return nil;
  }

  NSURL *root = [appSupport URLByAppendingPathComponent:@"OverTheAir" isDirectory:YES];
  if (![[NSFileManager defaultManager] fileExistsAtPath:root.path]) {
    if (![[NSFileManager defaultManager] createDirectoryAtURL:root
                                 withIntermediateDirectories:YES
                                                  attributes:nil
                                                       error:&error]) {
      NSLog(@"[OverTheAir] Could not create %@: %@", root.path, error);
      return nil;
    }
  }

  NSURL *excluded = root;
  NSError *excludeError = nil;
  if (![excluded setResourceValue:@YES forKey:NSURLIsExcludedFromBackupKey error:&excludeError]) {
    NSLog(@"[OverTheAir] Could not exclude %@ from backup: %@", root.path, excludeError);
  }
  return root;
}

+ (nullable NSURL *)versionRoot
{
  NSURL *root = [self rootDirectory];
  return root ? [root URLByAppendingPathComponent:[self appVersion] isDirectory:YES] : nil;
}

+ (nullable NSURL *)directoryNamed:(NSString *)name
{
  NSURL *versionRoot = [self versionRoot];
  return versionRoot ? [versionRoot URLByAppendingPathComponent:name isDirectory:YES] : nil;
}

+ (nullable NSURL *)currentDirectory
{
  return [self directoryNamed:@"current"];
}

+ (nullable NSURL *)stagingDirectory
{
  return [self directoryNamed:@"staging"];
}

+ (nullable NSURL *)backupDirectory
{
  return [self directoryNamed:@"backup"];
}

+ (NSString *)currentVersionKey
{
  return [OTACurrentVersionKeyPrefix stringByAppendingString:[self appVersion]];
}

+ (NSString *)pendingVersionKey
{
  return [OTAPendingVersionKeyPrefix stringByAppendingString:[self appVersion]];
}

+ (NSString *)pendingLaunchedKey
{
  return [OTAPendingLaunchedKeyPrefix stringByAppendingString:[self appVersion]];
}

/** The version that is running or will run: the pending one, else the confirmed one. */
+ (NSString *)installedVersion
{
  NSUserDefaults *defaults = [self defaults];
  NSString *pending = [defaults stringForKey:[self pendingVersionKey]];
  if (pending.length > 0) {
    return pending;
  }
  return [defaults stringForKey:[self currentVersionKey]] ?: @"";
}

#pragma mark - Launch, rollback and cleanup

+ (nullable NSURL *)bundleURL
{
  [self migrateLegacyStorageIfNeeded];
  [self pruneOtherVersions];
  [self resolvePendingLaunch];

  NSURL *bundle = [[self currentDirectory] URLByAppendingPathComponent:OTABundleFileName];
  if (!bundle) {
    return nil;
  }

  NSDictionary *attributes = [[NSFileManager defaultManager] attributesOfItemAtPath:bundle.path error:nil];
  if (!attributes || [attributes fileSize] == 0) {
    return nil;
  }
  return bundle;
}

+ (void)resolvePendingLaunch
{
  NSUserDefaults *defaults = [self defaults];
  if ([defaults stringForKey:[self pendingVersionKey]].length == 0) {
    OTADidResolvePendingLaunch = YES;
    return;
  }

  if (OTADidResolvePendingLaunch) {
    // An in-process reload, not a fresh launch: record that the pending bundle
    // has been handed out, but never roll back here.
    [defaults setBool:YES forKey:[self pendingLaunchedKey]];
    return;
  }
  OTADidResolvePendingLaunch = YES;

  if ([defaults boolForKey:[self pendingLaunchedKey]]) {
    [self rollback];
  } else {
    [defaults setBool:YES forKey:[self pendingLaunchedKey]];
  }
}

+ (void)rollback
{
  NSUserDefaults *defaults = [self defaults];
  NSLog(@"[OverTheAir] Bundle %@ never confirmed; rolling back",
        [defaults stringForKey:[self pendingVersionKey]]);

  NSFileManager *fileManager = [NSFileManager defaultManager];
  NSURL *current = [self currentDirectory];
  NSURL *backup = [self backupDirectory];
  if (current) {
    [fileManager removeItemAtURL:current error:nil];
  }
  if (backup && current && [fileManager fileExistsAtPath:backup.path]) {
    [fileManager moveItemAtURL:backup toURL:current error:nil];
  }
  [defaults removeObjectForKey:[self pendingVersionKey]];
  [defaults removeObjectForKey:[self pendingLaunchedKey]];
}

+ (void)confirmPendingUpdate
{
  NSUserDefaults *defaults = [self defaults];
  NSString *pending = [defaults stringForKey:[self pendingVersionKey]];
  if (pending.length == 0) {
    return;
  }

  [defaults setObject:pending forKey:[self currentVersionKey]];
  [defaults removeObjectForKey:[self pendingVersionKey]];
  [defaults removeObjectForKey:[self pendingLaunchedKey]];

  NSURL *backup = [self backupDirectory];
  if (backup) {
    [[NSFileManager defaultManager] removeItemAtURL:backup error:nil];
  }
  NSLog(@"[OverTheAir] Bundle %@ confirmed", pending);
}

/** Deletes bundles downloaded for other native app versions. */
+ (void)pruneOtherVersions
{
  NSURL *root = [self rootDirectory];
  if (!root) {
    return;
  }
  NSString *keep = [self appVersion];
  NSArray<NSURL *> *children = [[NSFileManager defaultManager] contentsOfDirectoryAtURL:root
                                                             includingPropertiesForKeys:nil
                                                                                options:0
                                                                                  error:nil];
  for (NSURL *child in children) {
    if (![child.lastPathComponent isEqualToString:keep]) {
      [[NSFileManager defaultManager] removeItemAtURL:child error:nil];
    }
  }
}

/** Moves bundles written by <= 0.1.x, which lived in Documents/ota/<version>/. */
+ (void)migrateLegacyStorageIfNeeded
{
  NSUserDefaults *defaults = [self defaults];
  if ([defaults boolForKey:OTALegacyMigrationKey]) {
    return;
  }
  [defaults setBool:YES forKey:OTALegacyMigrationKey];

  NSFileManager *fileManager = [NSFileManager defaultManager];
  NSURL *documents = [fileManager URLsForDirectory:NSDocumentDirectory inDomains:NSUserDomainMask].firstObject;
  NSURL *legacyRoot = [documents URLByAppendingPathComponent:@"ota" isDirectory:YES];
  if (!documents || ![fileManager fileExistsAtPath:legacyRoot.path]) {
    return;
  }

  NSString *appVersion = [self appVersion];
  NSURL *legacyVersionDir = [legacyRoot URLByAppendingPathComponent:appVersion isDirectory:YES];
  NSURL *current = [self currentDirectory];
  if (current && [fileManager fileExistsAtPath:legacyVersionDir.path] &&
      ![fileManager fileExistsAtPath:current.path]) {
    [fileManager createDirectoryAtURL:[current URLByDeletingLastPathComponent]
          withIntermediateDirectories:YES
                           attributes:nil
                                error:nil];
    if ([fileManager moveItemAtURL:legacyVersionDir toURL:current error:nil]) {
      // Anything already running before the upgrade is confirmed by definition.
      NSString *legacyVersion =
          [defaults stringForKey:[@"CurrentBundleVersion_" stringByAppendingString:appVersion]];
      if (legacyVersion.length > 0) {
        [defaults setObject:legacyVersion forKey:[self currentVersionKey]];
      }
    }
  }

  [fileManager removeItemAtURL:legacyRoot error:nil];
}

#pragma mark - TurboModule: simple accessors

- (void)setBaseURL:(NSString *)url allowInsecureHttp:(BOOL)allowInsecureHttp
{
  NSUserDefaults *defaults = [OverTheAir defaults];
  [defaults setObject:url forKey:OTABaseURLKey];
  [defaults setBool:allowInsecureHttp forKey:OTAAllowInsecureHTTPKey];
}

- (NSString *)getAppVersion
{
  return [OverTheAir appVersion];
}

- (NSString *)getBundleVersion
{
  return [OverTheAir installedVersion];
}

- (NSNumber *)isPendingUpdate
{
  NSString *pending = [[OverTheAir defaults] stringForKey:[OverTheAir pendingVersionKey]];
  return @(pending.length > 0);
}

- (void)notifyAppReady
{
  [OverTheAir confirmPendingUpdate];
}

- (void)resetToDefault
{
  NSURL *versionRoot = [OverTheAir versionRoot];
  if (versionRoot) {
    [[NSFileManager defaultManager] removeItemAtURL:versionRoot error:nil];
  }
  NSUserDefaults *defaults = [OverTheAir defaults];
  [defaults removeObjectForKey:[OverTheAir currentVersionKey]];
  [defaults removeObjectForKey:[OverTheAir pendingVersionKey]];
  [defaults removeObjectForKey:[OverTheAir pendingLaunchedKey]];
}

- (void)reloadBundle
{
  dispatch_async(dispatch_get_main_queue(), ^{
    // The host's bundleURL() is consulted again on reload, so the freshly
    // installed bundle is picked up without restarting the process.
    RCTTriggerReloadCommandListeners(@"OverTheAir: applying update");
  });
}

#pragma mark - TurboModule: manifest

- (void)checkForUpdates:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  NSString *baseURL = [[OverTheAir defaults] stringForKey:OTABaseURLKey];
  if (baseURL.length == 0) {
    reject(@"NO_BASE_URL", @"Base URL not set. Call setBaseURL first.", nil);
    return;
  }

  NSString *manifestURLString = [baseURL hasSuffix:@"/"]
      ? [baseURL stringByAppendingString:@"manifest.json"]
      : [baseURL stringByAppendingString:@"/manifest.json"];

  NSURL *manifestURL = [NSURL URLWithString:manifestURLString];
  NSError *schemeError = [self validateURL:manifestURL];
  if (schemeError) {
    reject(@"INSECURE_URL", schemeError.localizedDescription, schemeError);
    return;
  }

  NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:manifestURL];
  // Manifests change on every release; a CDN must not serve a stale one.
  request.cachePolicy = NSURLRequestReloadIgnoringLocalAndRemoteCacheData;
  request.timeoutInterval = OTAManifestTimeout;
  [request setValue:@"no-cache" forHTTPHeaderField:@"Cache-Control"];
  [request setValue:[OverTheAir appVersion] forHTTPHeaderField:@"X-App-Version"];
  [request setValue:OTAPlatform forHTTPHeaderField:@"X-Platform"];

  NSURLSessionDataTask *task = [self.session
      dataTaskWithRequest:request
        completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
          if (error) {
            reject(@"MANIFEST_ERROR", error.localizedDescription, error);
            return;
          }

          NSInteger status = ((NSHTTPURLResponse *)response).statusCode;
          if (status < 200 || status >= 300) {
            reject(@"MANIFEST_ERROR",
                   [NSString stringWithFormat:@"HTTP %ld for %@", (long)status, manifestURLString],
                   nil);
            return;
          }

          NSError *parseError = nil;
          id manifest = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:&parseError] : nil;
          if (![manifest isKindOfClass:[NSDictionary class]]) {
            reject(@"INVALID_MANIFEST", @"The manifest is not a JSON object.", parseError);
            return;
          }

          id platformUpdates = manifest[OTAPlatform];
          if (![platformUpdates isKindOfClass:[NSDictionary class]]) {
            resolve(nil);
            return;
          }

          id entry = ((NSDictionary *)platformUpdates)[[OverTheAir appVersion]];
          if (![entry isKindOfClass:[NSDictionary class]]) {
            resolve(nil);
            return;
          }

          NSString *url = [entry objectForKey:@"url"];
          NSString *version = [entry objectForKey:@"version"];
          if (![url isKindOfClass:[NSString class]] || url.length == 0 ||
              ![version isKindOfClass:[NSString class]] || version.length == 0) {
            reject(@"INVALID_MANIFEST",
                   [NSString stringWithFormat:@"The manifest entry for %@/%@ is missing \"url\" or \"version\".",
                                              OTAPlatform, [OverTheAir appVersion]],
                   nil);
            return;
          }

          if ([version isEqualToString:[OverTheAir installedVersion]]) {
            resolve(nil);
            return;
          }

          NSMutableDictionary *result = [NSMutableDictionary dictionaryWithDictionary:@{
            @"url" : url,
            @"version" : version,
            @"isMandatory" : @([[entry objectForKey:@"isMandatory"] boolValue]),
          }];
          NSString *hash = [entry objectForKey:@"hash"];
          if ([hash isKindOfClass:[NSString class]] && hash.length > 0) {
            result[@"hash"] = hash;
          }
          resolve(result);
        }];
  [task resume];
}

#pragma mark - TurboModule: install

- (void)installUpdate:(NSString *)url
              version:(NSString *)version
                 hash:(NSString *_Nullable)hash
              resolve:(RCTPromiseResolveBlock)resolve
               reject:(RCTPromiseRejectBlock)reject
{
  @synchronized(self) {
    if (_installing) {
      reject(@"ALREADY_INSTALLING", @"Another update is already being installed.", nil);
      return;
    }
    _installing = YES;
  }

  void (^finish)(id, NSString *, NSString *, NSError *) =
      ^(id result, NSString *code, NSString *message, NSError *error) {
        @synchronized(self) {
          self->_installing = NO;
        }
        if (code) {
          reject(code, message, error);
        } else {
          resolve(result);
        }
      };

  NSURL *bundleURL = [NSURL URLWithString:url];
  NSError *schemeError = [self validateURL:bundleURL];
  if (schemeError) {
    finish(nil, @"INSECURE_URL", schemeError.localizedDescription, schemeError);
    return;
  }

  NSError *error = nil;
  NSURL *staging = [self prepareStagingDirectory:&error];
  if (!staging) {
    finish(nil, @"DOWNLOAD_ERROR", error.localizedDescription, error);
    return;
  }

  NSURL *downloadURL = [[OverTheAir versionRoot] URLByAppendingPathComponent:@"download.tmp"];
  [[NSFileManager defaultManager] removeItemAtURL:downloadURL error:nil];

  [self downloadFrom:bundleURL
                  to:downloadURL
          completion:^(NSString *sha256, NSError *downloadError) {
            NSFileManager *fileManager = [NSFileManager defaultManager];
            NSError *installError = nil;
            NSString *code = nil;
            NSString *message = nil;

            if (downloadError) {
              code = @"DOWNLOAD_ERROR";
              message = downloadError.localizedDescription;
            } else if (hash.length > 0 && [hash caseInsensitiveCompare:sha256] != NSOrderedSame) {
              code = @"INTEGRITY_ERROR";
              message = [NSString stringWithFormat:@"Bundle integrity check failed: expected %@ but got %@",
                                                   hash, sha256];
            } else if (![self unpack:downloadURL into:staging fromURL:url error:&installError]) {
              code = @"DOWNLOAD_ERROR";
              message = installError.localizedDescription;
            } else if (![self promote:staging version:version error:&installError]) {
              code = @"DOWNLOAD_ERROR";
              message = installError.localizedDescription;
            }

            [fileManager removeItemAtURL:downloadURL error:nil];
            if (code) {
              [fileManager removeItemAtURL:staging error:nil];
              finish(nil, code, message, downloadError ?: installError);
            } else {
              finish(@YES, nil, nil, nil);
            }
          }];
}

- (nullable NSURL *)prepareStagingDirectory:(NSError **)error
{
  NSFileManager *fileManager = [NSFileManager defaultManager];
  NSURL *staging = [OverTheAir stagingDirectory];
  NSURL *current = [OverTheAir currentDirectory];
  if (!staging) {
    if (error) {
      *error = [NSError errorWithDomain:OTAErrorDomain
                                   code:1
                               userInfo:@{NSLocalizedDescriptionKey : @"No writable storage directory"}];
    }
    return nil;
  }

  [fileManager removeItemAtURL:staging error:nil];
  if (![fileManager createDirectoryAtURL:staging withIntermediateDirectories:YES attributes:nil error:error]) {
    return nil;
  }

  // Seed from the active bundle so an incremental package, which only carries
  // changed assets, merges onto what is already installed.
  if (current && [fileManager fileExistsAtPath:current.path]) {
    NSArray<NSURL *> *entries = [fileManager contentsOfDirectoryAtURL:current
                                          includingPropertiesForKeys:nil
                                                             options:0
                                                               error:nil];
    for (NSURL *entry in entries) {
      NSURL *destination = [staging URLByAppendingPathComponent:entry.lastPathComponent];
      [fileManager copyItemAtURL:entry toURL:destination error:nil];
    }
  }
  return staging;
}

- (BOOL)unpack:(NSURL *)archive into:(NSURL *)staging fromURL:(NSString *)url error:(NSError **)error
{
  NSFileManager *fileManager = [NSFileManager defaultManager];
  NSString *path = [[url componentsSeparatedByString:@"?"].firstObject lowercaseString];

  if ([path hasSuffix:@".zip"]) {
    NSError *unzipError = nil;
    BOOL unzipped = [SSZipArchive unzipFileAtPath:archive.path
                                    toDestination:staging.path
                                        overwrite:YES
                                         password:nil
                                            error:&unzipError];
    if (!unzipped) {
      if (error) {
        *error = unzipError ?: [NSError errorWithDomain:OTAErrorDomain
                                                   code:2
                                               userInfo:@{NSLocalizedDescriptionKey : @"Could not unzip the package"}];
      }
      return NO;
    }
    if (![self validateExtractedTree:staging error:error]) {
      return NO;
    }
    [self applyRemovalListIn:staging];
  } else {
    NSURL *destination = [staging URLByAppendingPathComponent:OTABundleFileName];
    [fileManager removeItemAtURL:destination error:nil];
    if (![fileManager moveItemAtURL:archive toURL:destination error:error]) {
      return NO;
    }
  }

  NSURL *bundle = [staging URLByAppendingPathComponent:OTABundleFileName];
  NSDictionary *attributes = [fileManager attributesOfItemAtPath:bundle.path error:nil];
  if (!attributes || [attributes fileSize] == 0) {
    if (error) {
      *error = [NSError errorWithDomain:OTAErrorDomain
                                   code:3
                               userInfo:@{
                                 NSLocalizedDescriptionKey : [NSString
                                     stringWithFormat:@"The package does not contain a usable %@", OTABundleFileName]
                               }];
    }
    return NO;
  }
  return YES;
}

/**
 * Deletes assets the CLI recorded as removed since the base build. Without this
 * an incremental package can only ever add files, so assets dropped from the
 * app would linger on device forever.
 */
- (void)applyRemovalListIn:(NSURL *)staging
{
  NSFileManager *fileManager = [NSFileManager defaultManager];
  NSURL *listURL = [staging URLByAppendingPathComponent:OTARemovalListName];
  NSData *data = [NSData dataWithContentsOfURL:listURL];
  if (!data) {
    return;
  }
  [fileManager removeItemAtURL:listURL error:nil];

  id parsed = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
  NSArray *entries = [parsed isKindOfClass:[NSDictionary class]] ? parsed[@"remove"] : nil;
  if (![entries isKindOfClass:[NSArray class]]) {
    return;
  }

  NSString *prefix = [staging.URLByStandardizingPath.path stringByAppendingString:@"/"];
  for (id entry in entries) {
    if (![entry isKindOfClass:[NSString class]] || [entry length] == 0) {
      continue;
    }
    NSURL *target = [[staging URLByAppendingPathComponent:entry] URLByStandardizingPath];
    if ([target.path hasPrefix:prefix]) {
      [fileManager removeItemAtURL:target error:nil];
    } else {
      NSLog(@"[OverTheAir] Ignoring out-of-bounds removal entry: %@", entry);
    }
  }
}

/**
 * Belt-and-braces check on top of SSZipArchive's own path sanitising: reject a
 * package that planted a symlink, which could otherwise redirect a later write
 * outside the OTA directory.
 */
- (BOOL)validateExtractedTree:(NSURL *)root error:(NSError **)error
{
  NSDirectoryEnumerator<NSURL *> *enumerator =
      [[NSFileManager defaultManager] enumeratorAtURL:root
                           includingPropertiesForKeys:@[ NSURLIsSymbolicLinkKey ]
                                              options:0
                                         errorHandler:nil];
  for (NSURL *entry in enumerator) {
    NSNumber *isSymlink = nil;
    [entry getResourceValue:&isSymlink forKey:NSURLIsSymbolicLinkKey error:nil];
    if (isSymlink.boolValue) {
      if (error) {
        *error = [NSError errorWithDomain:OTAErrorDomain
                                     code:4
                                 userInfo:@{
                                   NSLocalizedDescriptionKey :
                                       [NSString stringWithFormat:@"Package contains a symbolic link: %@",
                                                                  entry.lastPathComponent]
                                 }];
      }
      return NO;
    }
  }
  return YES;
}

/** Swaps `staging` in as the active bundle, keeping a rollback copy. */
- (BOOL)promote:(NSURL *)staging version:(NSString *)version error:(NSError **)error
{
  NSFileManager *fileManager = [NSFileManager defaultManager];
  NSUserDefaults *defaults = [OverTheAir defaults];
  NSURL *current = [OverTheAir currentDirectory];
  NSURL *backup = [OverTheAir backupDirectory];
  BOOL replacingUnconfirmed = [defaults stringForKey:[OverTheAir pendingVersionKey]].length > 0;

  if (!current || !backup) {
    if (error) {
      *error = [NSError errorWithDomain:OTAErrorDomain
                                   code:9
                               userInfo:@{NSLocalizedDescriptionKey : @"No writable storage directory"}];
    }
    return NO;
  }

  if (replacingUnconfirmed) {
    // What is active has not proven itself yet, so it is not a rollback target;
    // keep the older backup, which is the last confirmed bundle.
    [fileManager removeItemAtURL:current error:nil];
  } else {
    [fileManager removeItemAtURL:backup error:nil];
    if ([fileManager fileExistsAtPath:current.path] &&
        ![fileManager moveItemAtURL:current toURL:backup error:nil]) {
      [fileManager removeItemAtURL:current error:nil];
    }
  }

  if (![fileManager moveItemAtURL:staging toURL:current error:error]) {
    if (![fileManager fileExistsAtPath:current.path] && [fileManager fileExistsAtPath:backup.path]) {
      [fileManager moveItemAtURL:backup toURL:current error:nil];
    }
    return NO;
  }

  [defaults setObject:version forKey:[OverTheAir pendingVersionKey]];
  [defaults setBool:NO forKey:[OverTheAir pendingLaunchedKey]];
  return YES;
}

#pragma mark - Networking

- (nullable NSError *)validateURL:(nullable NSURL *)url
{
  if (!url) {
    return [NSError errorWithDomain:OTAErrorDomain
                               code:5
                           userInfo:@{NSLocalizedDescriptionKey : @"Invalid URL"}];
  }
  if ([[OverTheAir defaults] boolForKey:OTAAllowInsecureHTTPKey]) {
    return nil;
  }
  if ([url.scheme caseInsensitiveCompare:@"https"] == NSOrderedSame) {
    return nil;
  }
  return [NSError
      errorWithDomain:OTAErrorDomain
                 code:6
             userInfo:@{
               NSLocalizedDescriptionKey : [NSString
                   stringWithFormat:@"Refusing to load %@ over %@. Serve updates over HTTPS, or opt in "
                                    @"with setBaseURL(url, { allowInsecureHttp: true }).",
                                    url.absoluteString, url.scheme]
             }];
}

- (NSURLSession *)session
{
  @synchronized(self) {
    if (!_session) {
      NSURLSessionConfiguration *configuration = [NSURLSessionConfiguration defaultSessionConfiguration];
      configuration.timeoutIntervalForRequest = OTADownloadTimeout;
      NSOperationQueue *queue = [NSOperationQueue new];
      queue.maxConcurrentOperationCount = 1;
      _session = [NSURLSession sessionWithConfiguration:configuration delegate:self delegateQueue:queue];
    }
    return _session;
  }
}

/** Streams the response to `destination`, hashing and reporting progress as it goes. */
- (void)downloadFrom:(NSURL *)url
                  to:(NSURL *)destination
          completion:(void (^)(NSString *_Nullable sha256, NSError *_Nullable error))completion
{
  NSFileManager *fileManager = [NSFileManager defaultManager];
  [fileManager createDirectoryAtURL:[destination URLByDeletingLastPathComponent]
        withIntermediateDirectories:YES
                         attributes:nil
                              error:nil];
  if (![fileManager createFileAtPath:destination.path contents:nil attributes:nil]) {
    completion(nil, [NSError errorWithDomain:OTAErrorDomain
                                        code:7
                                    userInfo:@{NSLocalizedDescriptionKey : @"Could not open the download file"}]);
    return;
  }

  OTADownloadContext *context = [OTADownloadContext new];
  context.fileHandle = [NSFileHandle fileHandleForWritingToURL:destination error:nil];
  context.completion = completion;
  CC_SHA256_Init(&context->_digest);
  _download = context;

  NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url];
  request.timeoutInterval = OTADownloadTimeout;
  // Keep Content-Length meaningful for progress, and hash the bytes the server
  // actually published.
  [request setValue:@"identity" forHTTPHeaderField:@"Accept-Encoding"];
  [request setValue:[OverTheAir appVersion] forHTTPHeaderField:@"X-App-Version"];
  [request setValue:OTAPlatform forHTTPHeaderField:@"X-Platform"];

  [[self.session dataTaskWithRequest:request] resume];
}

- (void)finishDownloadWithError:(nullable NSError *)error
{
  OTADownloadContext *context = _download;
  _download = nil;
  if (!context) {
    return;
  }

  [context.fileHandle closeFile];
  if (error) {
    context.completion(nil, error);
    return;
  }

  unsigned char digest[CC_SHA256_DIGEST_LENGTH];
  CC_SHA256_Final(digest, &context->_digest);
  NSMutableString *hex = [NSMutableString stringWithCapacity:CC_SHA256_DIGEST_LENGTH * 2];
  for (int i = 0; i < CC_SHA256_DIGEST_LENGTH; i++) {
    [hex appendFormat:@"%02x", digest[i]];
  }
  [self emitProgressReceived:context.receivedBytes total:context.totalBytes];
  context.completion(hex, nil);
}

#pragma mark - NSURLSessionDataDelegate

- (void)URLSession:(NSURLSession *)session
              task:(NSURLSessionTask *)task
willPerformHTTPRedirection:(NSHTTPURLResponse *)response
        newRequest:(NSURLRequest *)request
 completionHandler:(void (^)(NSURLRequest *_Nullable))completionHandler
{
  // NSURLSession will happily follow an https -> http hop; that would hand
  // control of the JS bundle to anyone on the network.
  if ([self validateURL:request.URL]) {
    completionHandler(nil);
    return;
  }
  completionHandler(request);
}

- (void)URLSession:(NSURLSession *)session
          dataTask:(NSURLSessionDataTask *)dataTask
didReceiveResponse:(NSURLResponse *)response
 completionHandler:(void (^)(NSURLSessionResponseDisposition))completionHandler
{
  NSInteger status = ((NSHTTPURLResponse *)response).statusCode;
  if (status < 200 || status >= 300) {
    completionHandler(NSURLSessionResponseCancel);
    [self finishDownloadWithError:[NSError errorWithDomain:OTAErrorDomain
                                                      code:status
                                                  userInfo:@{
                                                    NSLocalizedDescriptionKey :
                                                        [NSString stringWithFormat:@"HTTP %ld", (long)status]
                                                  }]];
    return;
  }
  _download.totalBytes = MAX(response.expectedContentLength, 0);
  completionHandler(NSURLSessionResponseAllow);
}

- (void)URLSession:(NSURLSession *)session dataTask:(NSURLSessionDataTask *)dataTask didReceiveData:(NSData *)data
{
  OTADownloadContext *context = _download;
  if (!context) {
    return;
  }

  [data enumerateByteRangesUsingBlock:^(const void *bytes, NSRange range, BOOL *stop) {
    CC_SHA256_Update(&context->_digest, bytes, (CC_LONG)range.length);
  }];
  @try {
    [context.fileHandle writeData:data];
  } @catch (NSException *exception) {
    [dataTask cancel];
    [self finishDownloadWithError:[NSError errorWithDomain:OTAErrorDomain
                                                      code:8
                                                  userInfo:@{NSLocalizedDescriptionKey : exception.reason ?: @"Write failed"}]];
    return;
  }

  context.receivedBytes += (long long)data.length;
  NSTimeInterval now = [NSDate timeIntervalSinceReferenceDate];
  if (now - context.lastProgressAt >= OTAProgressInterval) {
    context.lastProgressAt = now;
    [self emitProgressReceived:context.receivedBytes total:context.totalBytes];
  }
}

- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task didCompleteWithError:(NSError *)error
{
  if (_download) {
    [self finishDownloadWithError:error];
  }
}

#pragma mark - Events

- (void)setEventEmitterCallback:(EventEmitterCallbackWrapper *)eventEmitterCallbackWrapper
{
  _eventEmitterCallback = std::move(eventEmitterCallbackWrapper->_eventEmitterCallback);
}

- (void)emitProgressReceived:(long long)received total:(long long)total
{
  if (!_eventEmitterCallback) {
    return;
  }
  _eventEmitterCallback("onDownloadProgress", @{
    @"receivedBytes" : @(received),
    @"totalBytes" : @(total),
  });
}

#pragma mark - TurboModule plumbing

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeOverTheAirSpecJSI>(params);
}

@end
