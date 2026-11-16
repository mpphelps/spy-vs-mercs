// Keyboard / mouse input with pointer lock. Tracks held keys plus per-frame "pressed" edges.

export class Input {
  private held = new Set<string>();
  private pressedThisFrame = new Set<string>();
  private releasedThisFrame = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  locked = false;
  onUnlock: (() => void) | null = null;

  constructor(private element: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      // Stop browser shortcuts from stealing game keys while playing
      if (this.locked && (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'AltLeft' || e.code === 'KeyF')) e.preventDefault();
      if (e.repeat) return;
      this.held.add(e.code);
      this.pressedThisFrame.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      if (this.locked && e.code === 'AltLeft') e.preventDefault();
      this.held.delete(e.code);
      this.releasedThisFrame.add(e.code);
    });
    window.addEventListener('mousedown', (e) => {
      const code = 'Mouse' + e.button;
      this.held.add(code);
      this.pressedThisFrame.add(code);
    });
    window.addEventListener('mouseup', (e) => {
      const code = 'Mouse' + e.button;
      this.held.delete(code);
      this.releasedThisFrame.add(code);
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    window.addEventListener('wheel', (e) => {
      if (!this.locked) return;
      this.wheel += Math.sign(e.deltaY);
    }, { passive: true });
    window.addEventListener('blur', () => this.held.clear());
    document.addEventListener('pointerlockchange', () => {
      const wasLocked = this.locked;
      this.locked = document.pointerLockElement === this.element;
      if (wasLocked && !this.locked) {
        this.held.clear();
        this.onUnlock?.();
      }
    });
  }

  requestLock() {
    try {
      const p = this.element.requestPointerLock() as unknown as Promise<void> | undefined;
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch { /* ignore */ }
  }

  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  down(code: string) { return this.held.has(code); }
  pressed(code: string) { return this.pressedThisFrame.has(code); }
  released(code: string) { return this.releasedThisFrame.has(code); }

  /** Call at end of each frame. */
  endFrame() {
    this.pressedThisFrame.clear();
    this.releasedThisFrame.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }

  clearAll() {
    this.held.clear();
    this.endFrame();
  }
}
