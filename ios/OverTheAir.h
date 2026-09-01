#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * Boot-time entry point for the OTA bundle.
 *
 * This header is deliberately plain Objective-C so that it can be imported
 * from Swift (`import OverTheAir`). The TurboModule surface is declared in the
 * implementation file, which is Objective-C++.
 *
 * Each native app version owns an isolated directory, so a bundle built
 * against an older binary is never handed to a newer one:
 *
 *   Library/Application Support/OverTheAir/<appVersion>/
 *       current/   active bundle + assets
 *       staging/   install in progress; promoted with a single move
 *       backup/    last confirmed-good bundle, restored if the new one fails
 */
@interface OverTheAir : NSObject

/**
 * The OTA bundle to load, or nil to fall back to the bundle inside the app.
 *
 * Call this from `bundleURL()` in your `RCTReactNativeFactoryDelegate`. It also
 * performs the rollback check: an update handed to a previous launch that was
 * never confirmed by `notifyAppReady()` is assumed to have failed and is
 * reverted here.
 */
+ (nullable NSURL *)bundleURL;

/** The native app version (`CFBundleShortVersionString`), or "unknown". */
+ (NSString *)appVersion;

@end

NS_ASSUME_NONNULL_END
