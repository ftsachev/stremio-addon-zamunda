const { serveHTTP } = require("stremio-addon-sdk");

// Add error handlers to prevent crashes
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});

const addonInterface = require("./src/addon.js");
serveHTTP(addonInterface, { port: 7000 });

