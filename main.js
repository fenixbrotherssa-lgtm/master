const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

// ---------------------------------------------------------------------------------------------
// SERVIDOR ELEGIDO DESDE EL LOGIN (2.4.2). Se escribe UNA vez con el engranaje del login y queda en
// la carpeta de datos del equipo (userData/servidor.json): no se pierde al actualizar ni al reinstalar,
// y no hace falta permiso de administrador (antes había que editar resources/config.js a mano).
// Orden: MH_API_URL (solo desarrollo) > servidor.json > config.js.
// ---------------------------------------------------------------------------------------------
let API_CONFIG = 'http://localhost:4000/api';   // lo que dice config.js (valor de fábrica)
let PUERTO_CONFIG = 4000;
let API_ACTUAL = API_CONFIG;
const archivoServidor = () => path.join(app.getPath('userData'), 'servidor.json');

// "192.168.1.10" → http://192.168.1.10:4000/api · "hotel.com" → https://hotel.com/api ·
// "10.0.0.5:4100" → http://10.0.0.5:4100/api · "http(s)://..." se respeta (se quita un /api final).
function apiDesdeDireccion(direccion) {
    let d = String(direccion || '').trim().replace(/\s+/g, '');
    if (!d) throw new Error('Escriba la IP o el dominio del servidor.');
    if (d.length > 200) throw new Error('La dirección es demasiado larga.');
    let url;
    if (/^https?:\/\//i.test(d)) {
        try { url = new URL(d); } catch (_) { throw new Error('La dirección no es válida.'); }
    } else {
        const host = d.split('/')[0];
        const hostSinPuerto = host.replace(/:\d+$/, '');
        const tienePuerto = /:\d+$/.test(host);
        const esIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(hostSinPuerto);
        const esDominio = !esIp && hostSinPuerto.includes('.') && hostSinPuerto.toLowerCase() !== 'localhost';
        const base = esDominio && !tienePuerto ? `https://${host}` : `http://${tienePuerto ? host : host + ':' + PUERTO_CONFIG}`;
        try { url = new URL(base); } catch (_) { throw new Error('La dirección no es válida.'); }
    }
    if (!url.hostname || !/^[a-z0-9.\-\[\]:]+$/i.test(url.hostname)) throw new Error('La dirección no es válida.');
    const ruta = url.pathname.replace(/\/+$/, '').replace(/\/api$/i, '');
    return `${url.protocol}//${url.host}${ruta}/api`;
}

function leerServidorGuardado() {
    try {
        const j = JSON.parse(fs.readFileSync(archivoServidor(), 'utf8'));
        if (j && j.direccion) return { direccion: String(j.direccion), apiUrl: apiDesdeDireccion(j.direccion), fecha: j.fecha || null };
    } catch (_) { /* no existe o está dañado: se usa config.js */ }
    return null;
}

function resolverApi() {
    if (!app.isPackaged && process.env.MH_API_URL) return process.env.MH_API_URL;
    const g = leerServidorGuardado();
    return g ? g.apiUrl : API_CONFIG;
}

{
    const { ipcMain } = require('electron');
    // index.html la pide al cargar (también tras recargar: los argumentos de la ventana no cambian)
    ipcMain.on('mh:api-url', (e) => { e.returnValue = API_ACTUAL; });
    ipcMain.handle('mh:servidor', () => {
        const g = leerServidorGuardado();
        return { guardado: g ? g.direccion : null, fecha: g ? g.fecha : null, apiUrl: API_ACTUAL, porDefecto: API_CONFIG,
                 desarrollo: !app.isPackaged && !!process.env.MH_API_URL };
    });
    ipcMain.handle('mh:servidor-normalizar', (e, direccion) => apiDesdeDireccion(direccion));
    ipcMain.handle('mh:servidor-guardar', (e, direccion) => {
        if (direccion === null) {                       // volver al de fábrica (config.js)
            try { fs.unlinkSync(archivoServidor()); } catch (_) { /* ya no estaba */ }
        } else {
            const apiUrl = apiDesdeDireccion(direccion);
            fs.mkdirSync(path.dirname(archivoServidor()), { recursive: true });
            fs.writeFileSync(archivoServidor(), JSON.stringify({ direccion: String(direccion).trim(), apiUrl, fecha: new Date().toISOString() }, null, 2), 'utf8');
        }
        API_ACTUAL = resolverApi();
        return { apiUrl: API_ACTUAL };
    });
}

function createWindow() {
    // 1. CARGA DINAMICA DE CONFIGURACION
    const configPath = app.isPackaged
        ? path.join(process.resourcesPath, 'config.js')
        : path.join(__dirname, 'config.js');

    try {
        if (fs.existsSync(configPath)) {
            delete require.cache[require.resolve(configPath)];
            const config = require(configPath);
            API_CONFIG = config.getApiUrl();
            if (config.PORT) PUERTO_CONFIG = Number(config.PORT) || 4000;
            console.log("Configuracion cargada con exito:", API_CONFIG);
        } else {
            console.warn("Archivo config no encontrado en: " + configPath);
        }
    } catch (err) {
        console.error("ERROR LEYENDO CONFIGURACION:", err.message);
    }
    // El servidor elegido en el login manda sobre config.js; MH_API_URL (solo desarrollo) sobre ambos.
    const apiFinal = API_ACTUAL = resolverApi();

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

// ============================================================================
//  IMPRESIÓN DIRECTA (2.1.4) — térmicas / matriciales ESC/POS y etiquetadoras TSPL
//  El renderer arma los bytes (modules/impresion.js) y aquí se mandan TAL CUAL a la cola de Windows
//  (RAW: sin pasar por el driver). Así funciona igual con cualquier marca (Epson, 3nStar, Xprinter...)
//  y con la cola "Generic / Text Only". En Mac/Linux: `lp -o raw`.
// ============================================================================
const RAW_CS = `
using System; using System.IO; using System.Runtime.InteropServices;
public static class P {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] public class DI { public string n; public string o; public string t; }
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool OpenPrinter(string n, out IntPtr h, IntPtr d);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool StartDocPrinter(IntPtr h, int l, [In] DI d);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool WritePrinter(IntPtr h, byte[] b, int c, out int w);
  public static int Main(string[] a) {
    if (a.Length < 2) { Console.Error.WriteLine("uso: rawprint <impresora> <archivo> [documento]"); return 2; }
    byte[] datos = File.ReadAllBytes(a[1]); IntPtr h;
    if (!OpenPrinter(a[0], out h, IntPtr.Zero)) { Console.Error.WriteLine("No se pudo abrir la impresora (error " + Marshal.GetLastWin32Error() + ")"); return 3; }
    try {
      if (!StartDocPrinter(h, 1, new DI { n = a.Length > 2 ? a[2] : "MasterHotel", t = "RAW" })) { Console.Error.WriteLine("StartDoc error " + Marshal.GetLastWin32Error()); return 4; }
      StartPagePrinter(h); int w; bool ok = WritePrinter(h, datos, datos.Length, out w); EndPagePrinter(h); EndDocPrinter(h);
      if (!ok) { Console.Error.WriteLine("WritePrinter error " + Marshal.GetLastWin32Error()); return 5; }
      Console.Write(w); return 0;
    } finally { ClosePrinter(h); }
  }
}`;
let _rawExe = null;
// El ayudante se compila UNA vez con el compilador C# que trae Windows (.NET Framework 4, presente en Windows 10/11)
// y queda en la carpeta de datos de la app: imprimir después tarda milisegundos, no segundos.
function ayudanteRaw() {
    if (_rawExe && fs.existsSync(_rawExe)) return _rawExe;
    const dir = app.getPath('userData');
    const exe = path.join(dir, 'mh_rawprint_v1.exe');
    if (fs.existsSync(exe)) return (_rawExe = exe);
    const win = process.env.SystemRoot || 'C:\\Windows';
    const csc = [path.join(win, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
                 path.join(win, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe')].find(p => fs.existsSync(p));
    if (!csc) throw new Error('No se encontró el compilador de .NET de Windows para la impresión directa.');
    const fuente = path.join(dir, 'mh_rawprint_v1.cs');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fuente, RAW_CS, 'utf8');
    require('child_process').execFileSync(csc, ['/nologo', '/target:exe', '/optimize', `/out:${exe}`, fuente], { windowsHide: true, timeout: 60000 });
    return (_rawExe = exe);
}

ipcMain.handle('mh:impresoras', async (e) => {
    const lista = await e.sender.getPrintersAsync();
    return lista.map(p => ({ nombre: p.name, descripcion: p.description || p.displayName || '', predeterminada: !!p.isDefault }));
});

ipcMain.handle('mh:imprimir-raw', async (e, impresora, base64, documento) => {
    if (!impresora || typeof impresora !== 'string') throw new Error('Falta la impresora.');
    const datos = Buffer.from(String(base64 || ''), 'base64');
    if (!datos.length) throw new Error('No hay nada que imprimir.');
    if (datos.length > 8 * 1024 * 1024) throw new Error('El trabajo de impresión es demasiado grande.');
    const tmp = path.join(require('os').tmpdir(), `mh_imp_${process.pid}_${Date.now()}.bin`);
    fs.writeFileSync(tmp, datos);
    try {
        const cp = require('child_process');
        if (process.platform === 'win32') {
            const exe = ayudanteRaw();
            await new Promise((resolve, reject) => cp.execFile(exe, [impresora, tmp, String(documento || 'MasterHotel').slice(0, 60)],
                { windowsHide: true, timeout: 30000 }, (err, stdout, stderr) =>
                    err ? reject(new Error((stderr || err.message).toString().trim())) : resolve(stdout)));
        } else {
            await new Promise((resolve, reject) => cp.execFile('lp', ['-d', impresora, '-o', 'raw', tmp], { timeout: 30000 },
                (err, stdout, stderr) => err ? reject(new Error((stderr || err.message).toString().trim())) : resolve(stdout)));
        }
        return { ok: true, bytes: datos.length };
    } finally {
        try { fs.unlinkSync(tmp); } catch (_) {}
    }
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