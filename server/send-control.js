// A cooperative stop lets an in-flight SMTP handoff finish and be journaled.
export function createSendControl() {
  let controller;
  return {
    start() { controller = new AbortController(); },
    stop() { controller?.abort(); },
    get stopped() { return Boolean(controller?.signal.aborted); },
    async wait(ms) {
      if (!controller || controller.signal.aborted) return;
      const signal = controller.signal;
      await new Promise(resolve => {
        const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
        const timer = setTimeout(done, ms);
        signal.addEventListener('abort', done, {once:true});
      });
    }
  };
}
