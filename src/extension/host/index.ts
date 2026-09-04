/**
 * The extension's implementation of the host contract.
 *
 * Deliberately NOT under `src/shared`: it is one host's answer, not the shared
 * question, and the shared tree is what the Dashboard will consume. Anything
 * living beside the contract would be dragged along with it.
 */
export { extensionHost } from './extension-adapter';
export { capturePage } from './extension-page-capture';
export { createExtensionTransport, installExtensionTransport } from './extension-transport';
