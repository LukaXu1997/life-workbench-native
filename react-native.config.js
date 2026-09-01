// Ensures the bundled Inter + Material Community Icon TTFs are copied into the
// native `assets/fonts/` directory for BOTH Android and iOS during `pod install`
// / `gradle` (via react-native-asset). This is what makes expo-font able to load
// them as native assets, bypassing the Metro `res/raw` pipeline that aapt2 strips
// in release builds.
module.exports = {
  assets: ['./assets/fonts/'],
};
