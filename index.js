// Polyfills must load FIRST (see src/polyfills.ts) — before App and therefore
// before any module that reaches iconv-lite (GB18030 decoding).
import './src/polyfills';
import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
