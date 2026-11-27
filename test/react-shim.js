// Lets src/react.js import 'react' in a plain browser page: re-exports the UMD global.
const R = window.React;
export default R;
export const { createElement, forwardRef, useEffect, useImperativeHandle, useRef, useState, StrictMode } = R;
