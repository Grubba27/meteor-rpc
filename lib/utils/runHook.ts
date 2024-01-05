const runHook = async (hook: Array<Function>, ...args: unknown[]) => {
  for (const fn of hook) {
    await fn(...args);
  }
}
export { runHook }
