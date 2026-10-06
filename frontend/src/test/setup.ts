import "@testing-library/jest-dom/vitest";

// JSDOM does not implement native dialog focus/inert behavior. Exercise the real
// browser for that boundary; unit tests still open, select and close the picker.
HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute("open");
  this.dispatchEvent(new Event("close"));
};
