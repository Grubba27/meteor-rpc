const runHook = (hook: Array<Function>, ...args: unknown[]) => {
  for (const fn of hook) {
    fn(...args);
  }
}
export { runHook }
