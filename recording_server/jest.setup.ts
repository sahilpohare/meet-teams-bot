jest.setTimeout(30000)

global.console.error = jest.fn()

// Mock les fonctions de Playwright pour les tests
jest.mock('./src/browser', () => ({
    initializeBrowser: jest.fn(),
    cleanupBrowser: jest.fn(),
    findBackgroundPage: jest.fn(),
    tryOpenBrowser: jest.fn(),
    utils: {
        listenPage: jest.fn(),
        removeListenPage: jest.fn(),
        getCachedExtensionId: jest.fn(),
        getExtensionId: jest.fn(),
        reload_extension: jest.fn(),
    },
}))
