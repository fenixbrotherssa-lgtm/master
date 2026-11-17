// telefonoWA.js — window.TelefonoWA (2.4.0)
// Muestra, debajo del campo de teléfono, cómo leerá el sistema el número para WhatsApp: de cualquier país,
// con la procedencia del huésped como pista (Backend/utils/telefono.js, GET /desayunos/telefono).
// Solo informa: no cambia lo que recepción escribió (eso se guarda tal cual en la ficha).
//   TelefonoWA.vincular(inputTelefono, inputProcedencia, elementoInfo)
const api = require('./api');

const BANDERAS = { EC: '🇪🇨', CO: '🇨🇴', PE: '🇵🇪', VE: '🇻🇪', US: '🇺🇸', CA: '🇨🇦', ES: '🇪🇸', AR: '🇦🇷', CL: '🇨🇱', MX: '🇲🇽',
    BR: '🇧🇷', BO: '🇧🇴', CU: '🇨🇺', PA: '🇵🇦', CR: '🇨🇷', DO: '🇩🇴', IT: '🇮🇹', FR: '🇫🇷', DE: '🇩🇪', GB: '🇬🇧', NL: '🇳🇱', CH: '🇨🇭',
    UY: '🇺🇾', PY: '🇵🇾', GT: '🇬🇹', HN: '🇭🇳', SV: '🇸🇻', NI: '🇳🇮', PT: '🇵🇹', CN: '🇨🇳', JP: '🇯🇵', KR: '🇰🇷', IL: '🇮🇱', AU: '🇦🇺' };
const COMO = {
    CON_CODIGO: 'con el código de país escrito', ECUADOR: 'celular de Ecuador',
    PAIS_PROCEDENCIA: 'por la procedencia del huésped', CODIGO_DETECTADO: 'el número ya trae el código de país',
};

const TelefonoWA = {
    async analizar(tel, procedencia) {
        const q = `tel=${encodeURIComponent(tel || '')}&procedencia=${encodeURIComponent(procedencia || '')}`;
        return (await api.get(`/desayunos/telefono?${q}`)).data;
    },

    pintar(el, a, tel) {
        if (!el) return;
        if (!String(tel || '').trim()) { el.innerHTML = ''; return; }
        if (!a) { el.innerHTML = ''; return; }
        if (a.valido) {
            el.innerHTML = `<span style="color:#2f855a;font-weight:800;">✓ WhatsApp ${BANDERAS[a.pais] || ''} ${a.internacional}</span>` +
                `<span style="color:#718096;"> · ${COMO[a.metodo] || ''}</span>`;
        } else {
            el.innerHTML = `<span style="color:#c05621;font-weight:800;">⚠ ${a.mensaje || 'Número no válido para WhatsApp'}</span>`;
        }
    },

    vincular(inputTel, inputProc, el) {
        if (!inputTel || !el || inputTel._telWA) return;
        inputTel._telWA = true;
        let t = null, ultimo = '';
        const correr = () => {
            clearTimeout(t);
            t = setTimeout(async () => {
                const tel = inputTel.value, proc = inputProc ? inputProc.value : '';
                const clave = tel + '|' + proc;
                if (clave === ultimo) return;
                ultimo = clave;
                if (!String(tel).trim()) return this.pintar(el, null, '');
                try { this.pintar(el, await this.analizar(tel, proc), tel); } catch (_) { el.innerHTML = ''; }
            }, 450);
        };
        inputTel.addEventListener('input', correr);
        inputTel.addEventListener('change', correr);
        if (inputProc) { inputProc.addEventListener('input', correr); inputProc.addEventListener('change', correr); }
        el._refrescar = () => { ultimo = ''; correr(); };
        correr();
    },

    /** Para cuando el valor se llena por código (búsqueda de cliente). */
    refrescar(el) { if (el && el._refrescar) el._refrescar(); },
};

window.TelefonoWA = TelefonoWA;
module.exports = TelefonoWA;
