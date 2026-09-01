# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# react-native-reanimated
-keep class com.swmansion.reanimated.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }

# PDFBox JPEG2000 (JPX) decoder — optional codec, R8 strips it because it's only
# loaded reflectively at runtime by com.tom_roush.pdfbox.filter.JPXFilter.
# Keep just this one class (not the entire pdfbox library).
-dontwarn com.gemalto.jp2.**
-keep class com.gemalto.jp2.JP2Decoder { *; }
