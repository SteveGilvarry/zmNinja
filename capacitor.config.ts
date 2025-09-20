import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.zoneminder.zmNinja',
  appName: 'zmninja',
  webDir: 'www',
  cordova: {
    preferences: {
      KeyboardResize: 'true',
      KeyboardResizeMode: 'ionic',
      iosPersistentFileLocation: 'Library',
      AllowInlineMediaPlayback: 'true',
      DisallowOverscroll: 'true',
      BackupWebStorage: 'none',
      AutoHideSplashScreen: 'false',
      ShowSplashScreenSpinner: 'false',
      SplashScreen: 'screen',
      SplashScreenDelay: '300',
      SplashMaintainAspectRatio: 'true',
      FadeSplashScreen: 'false',
      BackgroundColor: '#444444',
      'android-targetSdkVersion': '35',
      'android-compileSdkVersion': '35',
      'android-minSdkVersion': '22',
      SplashScreenBackgroundColor: '#ababab',
      StatusBarOverlaysWebView: 'false',
      StatusBarBackgroundColor: '#2980b9',
      SplashShowOnlyFirstTime: 'false'
    }
  }
};

export default config;
