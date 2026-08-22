const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

function createWindow() {
    // 1. CARGA DINAMICA DE CONFIGURACION
    const configPath = app.isPackaged
        ? path.join(process.resourcesPath, 'config.js')
        : path.join(__dirname, 'config.js');

    let apiFinal = 'http://localhost:4000/api';
    try {
        if (fs.existsSync(configPath)) {
            delete require.cache[require.resolve(configPath)];
            const config = require(configPath);
            apiFinal = config.getApiUrl();
            console.log("Configuracion cargada con exito:", apiFinal);
        } else {
            console.warn("Archivo config no encontrado en: " + configPath);
        }
    } catch (err) {
        console.error("ERROR LEYENDO CONFIGURACION:", err.message);
    }

    // 2. CREACION DE LA VENTANA
    const win = new BrowserWindow({
        width: 1400,
        height: 900,
        title: "MasterHotel v1.0",
        backgroundColor: '#0a0a0b',
        icon: path.join(__dirname, 'assets/logo.png'),
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true,
            devTools: !app.isPackaged,
            additionalArguments: [`--api-url=${apiFinal}`]
        }
    });

    win.loadFile('index.html');

    win.setMenu(null);

    if (!app.isPackaged) {
        win.webContents.openDevTools();
    } else {
        win.webContents.on('devtools-opened', () => {
            win.webContents.closeDevTools();
        });
    }

    win.webContents.on('before-input-event', (event, input) => {
        if (input.key === 'F11') {
            win.setFullScreen(!win.isFullScreen());
            return;
        }

        if (!app.isPackaged) {
            if (((input.control || input.meta) && input.key.toLowerCase() === 'r') || input.key === 'F5') {
                win.reload();
            }
            if ((input.control || input.meta) && input.shift && input.key.toLowerCase() === 'i') {
                win.webContents.toggleDevTools();
            }
        } else {
            if (
                (((input.control || input.meta) && input.key.toLowerCase() === 'r') || input.key === 'F5') ||
                (((input.control || input.meta) && input.shift && input.key.toLowerCase() === 'i') || input.key === 'F12')
            ) {
                event.preventDefault();
            }
        }
    });
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});