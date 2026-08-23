/**
 * App entry.
 *
 * expo-router/entry alone is not enough: TaskManager.defineTask must run in the
 * global scope at startup, including on a HEADLESS launch when Android wakes the
 * app to run a background job. Reaching the task definition only through a React
 * component module means it is never evaluated in that context — the native side
 * then finds no JS handler and the worker finishes in milliseconds having done
 * nothing. Importing it here evaluates it before the router mounts anything.
 *
 * See https://docs.expo.dev/versions/v57.0.0/sdk/background-task/ — "This needs
 * to be called in the global scope, not in a React component."
 */
import "./src/lib/backgroundSync";
import "expo-router/entry";
