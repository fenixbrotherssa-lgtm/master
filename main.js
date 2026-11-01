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
    // Solo desarrollo: apuntar a otro backend sin tocar config.js (ej. un backend de prueba).
    if (!app.isPackaged && process.env.MH_API_URL) apiFinal = process.env.MH_API_URL;

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

// ---------------------------------------------------------------------------------------------
// Actualización del escritorio (solo Windows). El aviso lo decide la ventana: cuando el SERVIDOR del
// hotel ya está en una versión mayor que este equipo. Aquí se descarga el instalador publicado en
// casrodsoft.com, se comprueba el SHA-256 del manifiesto y se ejecuta en silencio; la app se cierra y
// el instalador la vuelve a abrir. config.js (dirección del servidor) no se toca.
// ---------------------------------------------------------------------------------------------
const MANIFIESTO = 'https://www.casrodsoft.com/downloads/masterhotel-backend.json';
function descargar(url, destino, redir = 0) {
    const https = require('https');
    return new Promise((resolve, reject) => {
        https.get(url, { timeout: 30000 }, res => {
            if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && redir < 5) {
                res.resume(); return resolve(descargar(new URL(res.headers.location, url).href, destino, redir + 1));
            }
            if (res.statusCode !== 200) { res.resume(); return reject(new Error('La descarga respondió ' + res.statusCode)); }
            if (!destino) { let t = ''; res.setEncoding('utf8'); res.on('data', c => { t += c; }); res.on('end', () => resolve(t)); return; }
            const f = fs.createWriteStream(destino);
            res.pipe(f); f.on('finish', () => f.close(() => resolve(destino))); f.on('error', reject);
        }).on('timeout', function () { this.destroy(new Error('Tiempo de espera agotado')); }).on('error', reject);
    });
}
const { ipcMain } = require('electron');
ipcMain.handle('mh:version', () => app.getVersion());
ipcMain.handle('mh:manifiesto', async () => JSON.parse(await descargar(MANIFIESTO)));
ipcMain.handle('mh:actualizar-escritorio', async (e, versionServidor) => {
    if (process.platform !== 'win32') throw new Error('En Mac la actualización se descarga desde casrodsoft.com.');
    const m = JSON.parse(await descargar(MANIFIESTO));
    if (m.version !== versionServidor) throw new Error(`El instalador publicado (${m.version}) no coincide con el servidor del hotel (${versionServidor}).`);
    if (!/^https:\/\/(www\.)?casrodsoft\.com\//.test(m.descargaCliente || '')) throw new Error('El manifiesto no apunta a casrodsoft.com.');
    const destino = path.join(require('os').tmpdir(), `Setup_MasterHotel_Cliente_v${m.version}.exe`);
    await descargar(m.descargaCliente, destino);
    if (m.sha256Cliente) {
        const h = require('crypto').createHash('sha256').update(fs.readFileSync(destino)).digest('hex');
        if (h !== String(m.sha256Cliente).toLowerCase()) throw new Error('La descarga no coincide con la publicada (SHA-256). No se instaló nada.');
    }
    require('child_process').spawn(destino, ['/SILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/CLOSEAPPLICATIONS'], { detached: true, stdio: 'ignore' }).unref();
    setTimeout(() => app.quit(), 1500);
    return { ok: true, version: m.version };
});

// Una sola instancia: evita procesos colgados que impiden actualizar.
if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    app.on('second-instance', () => {
        const w = BrowserWindow.getAllWindows()[0];
        if (w) { if (w.isMinimized()) w.restore(); w.focus(); }
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