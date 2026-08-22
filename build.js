// ============================================================
//  build.js  -  MasterHotel Frontend (Electron)
//  CasRodsoft Development
// ============================================================

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const JavaScriptObfuscator = require('javascript-obfuscator');

const ROOT = __dirname;
const DIST_SRC = path.join(ROOT, 'dist_src'); // Carpeta temporal ofuscada
const DIST_BIN = path.join(ROOT, 'dist');     // Carpeta final con el .exe compilado

// 1. Lo que se ofusca
const OBFUSCAR = [
    'modules',
    'views',
    'app.js',
    'main.js'
];

// 2. Lo que se copia intacto
const COPIAR_TAL_CUAL = [
    'assets',
    'node_modules',
    'public',
    'estructura.html',
    'index.html',
    'package.json',
    'package-lock.json'
];

const OPCIONES_OFUSCADOR = {
    compact: true,
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 0.4,
    deadCodeInjection: false,
    debugProtection: false,
    disableConsoleOutput: false,
    identifierNamesGenerator: 'hexadecimal',
    renameGlobals: false,
    rotateStringArray: true,
    selfDefending: true,
    shuffleStringArray: true,
    splitStrings: true,
    splitStringsChunkLength: 10,
    stringArray: true,
    stringArrayEncoding: ['base64'],
    stringArrayIndexShift: true,
    stringArrayWrappersCount: 2,
    stringArrayWrappersChainedCalls: true,
    stringArrayThreshold: 0.75,
    unicodeEscapeSequence: false,
};

function limpiarDir(dirPath) {
    if (fs.existsSync(dirPath)) {
        fs.rmSync(dirPath, { recursive: true, force: true });
    }
}

function asegurarDir(dirPath) {
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function copiarDir(src, dest) {
    asegurarDir(dest);
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) copiarDir(srcPath, destPath);
        else fs.copyFileSync(srcPath, destPath);
    }
}

function ofuscarDir(src, dest) {
    asegurarDir(dest);
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
            ofuscarDir(srcPath, destPath);
        } else if (entry.name.endsWith('.js')) {
            try {
                const codigo = fs.readFileSync(srcPath, 'utf8');
                const resultado = JavaScriptObfuscator.obfuscate(codigo, OPCIONES_OFUSCADOR);
                fs.writeFileSync(destPath, resultado.getObfuscatedCode(), 'utf8');
            } catch (err) {
                console.error("  Error ofuscando " + entry.name + ": " + err.message);
                fs.copyFileSync(srcPath, destPath);
            }
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

async function build() {
    console.log('\n========================================');
    console.log('  MasterHotel Frontend - Build');
    console.log('========================================\n');

    limpiarDir(DIST_SRC);
    limpiarDir(DIST_BIN);
    asegurarDir(DIST_SRC);

    console.log('Copiando recursos y modulos...');
    for (const recurso of COPIAR_TAL_CUAL) {
        const src = path.join(ROOT, recurso);
        const dest = path.join(DIST_SRC, recurso);
        if (!fs.existsSync(src)) continue;
        if (fs.statSync(src).isDirectory()) copiarDir(src, dest);
        else fs.copyFileSync(src, dest);
    }

    console.log('Ofuscando codigo fuente...');
    for (const objetivo of OBFUSCAR) {
        const src = path.join(ROOT, objetivo);
        const dest = path.join(DIST_SRC, objetivo);
        if (!fs.existsSync(src)) continue;

        if (fs.statSync(src).isDirectory()) {
            ofuscarDir(src, dest);
        } else {
            try {
                const codigo = fs.readFileSync(src, 'utf8');
                const resultado = JavaScriptObfuscator.obfuscate(codigo, OPCIONES_OFUSCADOR);
                fs.writeFileSync(dest, resultado.getObfuscatedCode(), 'utf8');
            } catch (err) {
                fs.copyFileSync(src, dest);
            }
        }
    }

    // RED DE SEGURIDAD: copia config.js tal cual al paquete (sin ofuscar).
    // Asi la app funciona aunque Inno Setup no lo coloque en resources.
    const cfgSrc = path.join(ROOT, 'config.js');
    if (fs.existsSync(cfgSrc)) {
        fs.copyFileSync(cfgSrc, path.join(DIST_SRC, 'config.js'));
        console.log('config.js incluido en el paquete.');
    } else {
        console.warn('AVISO: config.js no existe en la raiz, no se incluyo.');
    }

    // Por defecto compila para Windows (comportamiento local de siempre).
    // En CI (GitHub Actions, runner macOS) se setea TARGET_PLATFORM=darwin.
    const PLATFORM = process.env.TARGET_PLATFORM || 'win32';

    if (PLATFORM === 'darwin') {
        const ICON = './assets/icono.icns';
        for (const arch of ['x64', 'arm64']) {
            console.log(`\nEmpaquetando con Electron Packager (macOS ${arch})...`);
            try {
                execSync(`npx electron-packager ./dist_src MasterHotel --platform=darwin --arch=${arch} --out=./dist --overwrite --icon=${ICON}`, { stdio: 'inherit' });
                console.log(`\nCOMPILACION macOS ${arch} EXITOSA`);
            } catch (err) {
                console.error(`\nError en Electron Packager (${arch}):`, err.message);
            }
        }
    } else {
        console.log('\nEmpaquetando con Electron Packager (Windows)...');
        try {
            execSync('npx electron-packager ./dist_src MasterHotel --platform=win32 --arch=x64 --out=./dist --overwrite --icon=./assets/icono.ico', { stdio: 'inherit' });
            console.log('\nCOMPILACION DE ELECTRON EXITOSA');
        } catch (err) {
            console.error('\nError en Electron Packager:', err.message);
        }
    }

    limpiarDir(DIST_SRC);
}

build();