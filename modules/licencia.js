// licencia.js — licencia on-premise (perpetua) y actualizaciones del servidor del hotel. Solo administrador.
const api = require('./api');

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const MODOS = {
    ACTIVA: ['lic-ok', 'ACTIVA'],
    SIN_CLAVE: ['lic-warn', 'SIN REGISTRAR'],
    NO_ACTIVADA: ['lic-warn', 'SIN ACTIVAR'],
    REVOCADA: ['lic-mal', 'REVOCADA'],
    OTRA_MAQUINA: ['lic-mal', 'DE OTRO SERVIDOR'],
    FIRMA_INVALIDA: ['lic-mal', 'NO VÁLIDA'],
};
const fila = (k, v) => `<div class="lic-fila"><span>${k}</span><b>${v}</b></div>`;
const fmt = f => f ? f.split('-').reverse().join('/') : '—';

const LicenciaModule = {
    async init() {
        window.LicenciaModule = this;
        await this.cargar();
    },

    async cargar() {
        try {
            const { data: e } = await api.get('/licencia/estado');
            const [cls, txt] = MODOS[e.modo] || ['lic-mal', e.modo];
            let html = `<div style="margin-bottom:10px;"><span class="lic-pill ${cls}">${txt}</span></div>`;
            if (e.modo === 'ACTIVA' || e.modo === 'REVOCADA') {
                html += fila('Hotel', esc(e.cliente)) + fila('Clave', esc(e.clave)) + fila('Sedes permitidas', e.maxSedes)
                    + fila('Mantenimiento', `<span class="lic-pill ${e.mantenimientoVigente ? 'lic-ok' : 'lic-mal'}">${e.mantenimientoVigente ? 'Vigente' : 'Vencido'}</span> hasta ${fmt(e.mantenimientoHasta)}`);
            } else if (e.modo === 'SIN_CLAVE') {
                html += `<p class="lic-nota" style="margin-top:0;">Este servidor todavía no tiene una licencia registrada. El sistema funciona con normalidad;
                         registre la clave para recibir actualizaciones y soporte.</p>`;
            } else {
                html += `<p class="lic-nota" style="margin-top:0;">${e.modo === 'OTRA_MAQUINA' ? 'La licencia guardada pertenece a otro servidor (se copió el archivo o cambió el equipo).' : 'La licencia guardada no se pudo verificar.'}
                         Vuelva a registrar la clave o contacte a CasRodsoft.</p>`;
            }
            html += fila('Versión instalada', esc(e.version)) + fila('Huella del servidor', `<code>${esc(e.huellaCorta)}…</code>`)
                + fila('Última sincronización', e.ultimaSync ? new Date(e.ultimaSync).toLocaleString('es-EC') : '—');
            if (e.ultimoError) html += `<p class="lic-nota" style="color:#9b2c2c;"><i class="fas fa-triangle-exclamation"></i> ${esc(e.ultimoError)}</p>`;
            document.getElementById('licEstado').innerHTML = html;
            document.getElementById('licSync').style.display = e.modo === 'SIN_CLAVE' ? 'none' : '';
        } catch (err) {
            document.getElementById('licEstado').innerHTML = `<span style="color:#c53030;">${esc(err.response?.data?.error || 'No se pudo consultar la licencia.')}</span>`;
        }
        this.cargarActualizaciones();
    },

    async cargarActualizaciones() {
        const box = document.getElementById('updEstado'), acc = document.getElementById('updAccion');
        try {
            const { data: u } = await api.get('/actualizaciones/estado', { timeout: 30000 });
            if (!u.configurado) { box.innerHTML = `<span style="color:#9b2c2c;">${esc(u.error)}</span>`; acc.innerHTML = ''; return; }
            box.innerHTML = fila('Versión instalada', esc(u.actual)) + fila('Última publicada', esc(u.disponible || '—'))
                + (u.hayNueva ? `<div class="lic-notas-ver"><b>Novedades de la ${esc(u.disponible)}:</b><br>${esc(u.notas)}</div>` : `<p class="lic-nota"><i class="fas fa-circle-check" style="color:#2f855a;"></i> El servidor está al día.</p>`);
            acc.innerHTML = u.hayNueva
                ? (u.permitido ? `<button class="lic-btn oro" onclick="LicenciaModule.actualizar('${esc(u.disponible)}')"><i class="fas fa-download"></i> ACTUALIZAR AHORA A ${esc(u.disponible)}</button>`
                               : `<p class="lic-nota" style="color:#744210;"><i class="fas fa-lock"></i> ${esc(u.motivo)}</p>`)
                : '';
        } catch (err) {
            box.innerHTML = `<span style="color:#c53030;">${esc(err.response?.data?.error || 'No se pudo consultar las actualizaciones.')}</span>`;
        }
    },

    async registrar() {
        const clave = document.getElementById('licClave').value.trim().toUpperCase();
        if (!/^MH-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(clave))
            return Swal.fire('Clave', 'Escriba la clave completa: MH-XXXX-XXXX-XXXX-XXXX', 'warning');
        Swal.fire({ title: 'Activando licencia...', text: 'Conectando con el servidor de licencias de CasRodsoft', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
        try {
            const { data } = await api.post('/licencia/registrar', { clave }, { timeout: 40000 });
            await Swal.fire({ icon: 'success', title: 'Licencia activada', html: `<b>${esc(data.cliente)}</b><br>${data.maxSedes} sede(s) · mantenimiento hasta ${fmt(data.mantenimientoHasta)}` });
            document.getElementById('licClave').value = '';
            this.cargar();
        } catch (err) {
            Swal.fire('No se activó', err.response?.data?.error || 'No se pudo contactar al servidor de licencias. Revise el internet del servidor.', 'error');
        }
    },

    async sincronizar() {
        try {
            await api.post('/licencia/sincronizar', {}, { timeout: 40000 });
            window.Toast && window.Toast.fire({ icon: 'success', title: 'Licencia sincronizada' });
        } catch (err) {
            Swal.fire('Sin sincronizar', (err.response?.data?.error || 'Sin conexión') + '<br><small>La licencia sigue vigente con los datos guardados.</small>', 'info');
        }
        this.cargar();
    },

    async actualizar(version) {
        const ok = await Swal.fire({ icon: 'question', title: `¿Actualizar el servidor a ${version}?`, showCancelButton: true, confirmButtonText: 'Actualizar ahora',
            html: 'El sistema se detendrá uno o dos minutos en <b>todas</b> las computadoras. Hágalo en un momento tranquilo.<br><br>' +
                  '<small>Antes de una versión con cambios de base de datos, CasRodsoft le indicará las migraciones a correr.</small>' });
        if (!ok.isConfirmed) return;
        Swal.fire({ title: 'Descargando la actualización...', text: 'Puede tardar unos minutos según el internet.', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
        try {
            await api.post('/actualizaciones/aplicar', {}, { timeout: 15 * 60 * 1000 });
            Swal.fire({ title: 'Instalando...', html: 'El servidor se está actualizando. Esta pantalla se recargará sola en unos 2 minutos.', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
            setTimeout(() => window.location.reload(), 120000);
        } catch (err) {
            Swal.fire('No se actualizó', err.response?.data?.error || 'Error al descargar la actualización.', 'error');
        }
    },
};

module.exports = LicenciaModule;
