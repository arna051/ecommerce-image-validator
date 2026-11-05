import { ImageValidatorError } from "./errors.js";

interface Waiter {
  resolve: (release: () => void) => void;
  reject: (error: ImageValidatorError) => void;
  signal?: AbortSignal;
  abort?: () => void;
}

export class Semaphore {
  readonly #limit: number;
  #active = 0;
  readonly #queue: Waiter[] = [];

  constructor(limit: number) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new ImageValidatorError(
        "INVALID_CONFIGURATION",
        "Concurrency must be a positive integer.",
      );
    }
    this.#limit = limit;
  }

  acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) {
      return Promise.reject(
        new ImageValidatorError("ABORTED", "Image validation was aborted."),
      );
    }
    if (this.#active < this.#limit) {
      this.#active += 1;
      return Promise.resolve(this.#releaseOnce());
    }
    return new Promise((resolve, reject) => {
      const waiter: Waiter = { resolve, reject };
      if (signal) {
        waiter.signal = signal;
        waiter.abort = (): void => {
          const index = this.#queue.indexOf(waiter);
          if (index >= 0) this.#queue.splice(index, 1);
          reject(
            new ImageValidatorError("ABORTED", "Image validation was aborted."),
          );
        };
        signal.addEventListener("abort", waiter.abort, { once: true });
      }
      this.#queue.push(waiter);
    });
  }

  #releaseOnce(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.#queue.shift();
      if (next) {
        if (next.signal && next.abort)
          next.signal.removeEventListener("abort", next.abort);
        next.resolve(this.#releaseOnce());
      } else {
        this.#active -= 1;
      }
    };
  }
}
