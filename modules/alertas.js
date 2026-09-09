/* ============================================================================
 *  alertas.js — Alertas sonoras (no invasivas) + voz para MasterHotel
 *  Global: window.Alertas
 *
 *  - Sonidos sintetizados con Web Audio API (sin archivos).
 *  - Voz con speechSynthesis (voz en español del sistema).
 *  - Botón 🔊/🔇 en el header para silenciar (persistido en localStorage).
 *
 *  Uso:
 *      Alertas.beep('reserva');
 *      Alertas.hablar('Bienvenido, Juan');
 *      Alertas.notificar('whatsapp', 'Un huésped pide hablar con recepción');
 * ========================================================================== */
window.Alertas = (function () {
    'use strict';

    var LS_SON = 'alertas_mute_sonido';
    var LS_VOZ = 'alertas_mute_voz';

    function leerMute(k) { try { return localStorage.getItem(k) === '1'; } catch (e) { return false; } }
    var muteSonido = leerMute(LS_SON);
    var muteVoz = leerMute(LS_VOZ);

    // ---------- Web Audio ----------
    var ctx = null;
    function ac() {
        try {
            if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
            if (ctx.state === 'suspended') ctx.resume().catch(function () {});
        } catch (e) { return null; }
        return ctx;
    }

    // notas: [{ f: Hz, t: offset s, d: dur s, type?: 'sine'|'triangle'|... }]
    function tocar(notas, gainMax) {
        if (muteSonido) return;
        var c = ac(); if (!c) return;
        var now = c.currentTime;
        notas.forEach(function (n) {
            var o = c.createOscillator();
            o.type = n.type || 'sine';
            o.frequency.value = n.f;
            var g = c.createGain();
            var t0 = now + n.t;
            g.gain.setValueAtTime(0.0001, t0);
            g.gain.exponentialRampToValueAtTime(gainMax || 0.14, t0 + 0.02);
            g.gain.exponentialRampToValueAtTime(0.0001, t0 + n.d);
            o.connect(g); g.connect(c.destination);
            o.start(t0);
            o.stop(t0 + n.d + 0.05);
        });
    }

    var PATRONES = {
        reserva:  [{ f: 660, t: 0, d: 0.12 }, { f: 880, t: 0.13, d: 0.20 }],
        whatsapp: [{ f: 520, t: 0, d: 0.10 }, { f: 520, t: 0.16, d: 0.10 }, { f: 720, t: 0.34, d: 0.18 }],
        cocina:   [{ f: 784, t: 0, d: 0.10 }, { f: 988, t: 0.12, d: 0.16 }],
        pago:     [{ f: 587, t: 0, d: 0.10 }, { f: 784, t: 0.11, d: 0.10 }, { f: 1046, t: 0.22, d: 0.22 }],
        exito:    [{ f: 659, t: 0, d: 0.09 }, { f: 988, t: 0.10, d: 0.18 }],
        alerta:   [{ f: 466, t: 0, d: 0.16 }, { f: 392, t: 0.18, d: 0.22 }],
        error:    [{ f: 311, t: 0, d: 0.20 }, { f: 233, t: 0.18, d: 0.30 }]
    };

    function beep(tipo) {
        var fuerte = (tipo === 'whatsapp' || tipo === 'alerta');
        tocar(PATRONES[tipo] || PATRONES.exito, fuerte ? 0.20 : 0.13);
    }

    // ---------- Voz ----------
    var LS_VOZ_PREF = 'alertas_voz_nombre';   // nombre exacto/parcial de voz elegida a mano
    var voz = null;

    function todasLasVoces() {
        if (!('speechSynthesis' in window)) return [];
        return window.speechSynthesis.getVoices() || [];
    }

    // Prioridad: voz elegida a mano → español LATINO (MX, US, 419, CO, EC, AR, CL, PE…)
    //            → español España → cualquier "es" → null (usa la del sistema)
    function elegirVoz() {
        var vs = todasLasVoces();
        if (!vs.length) return null;

        var pref = '';
        try { pref = (localStorage.getItem(LS_VOZ_PREF) || '').toLowerCase(); } catch (e) {}
        if (pref) {
            var elegida = vs.find(function (v) {
                return (v.name || '').toLowerCase().indexOf(pref) !== -1
                    || (v.lang || '').toLowerCase().indexOf(pref) !== -1;
            });
            if (elegida) return elegida;
        }

        var reLatino = /^es[-_](419|MX|US|CO|EC|AR|CL|PE|VE|BO|CR|DO|GT|HN|NI|PA|PY|SV|UY)/i;
        var reNombreLatino = /(sabina|paulina|raul|dalia|latin|latino|m[eé]xico|mexican|colombia|estados unidos)/i;

        return vs.find(function (v) { return reLatino.test(v.lang || ''); })
            || vs.find(function (v) { return reNombreLatino.test(v.name || '') && /^es/i.test(v.lang || ''); })
            || vs.find(function (v) { return /^es[-_]es/i.test(v.lang || ''); })
            || vs.find(function (v) { return /^es/i.test(v.lang || ''); })
            || null;
    }

    if ('speechSynthesis' in window) {
        voz = elegirVoz();
        try { window.speechSynthesis.onvoiceschanged = function () { voz = elegirVoz(); }; } catch (e) {}
    }

    // Utilidades para elegir/inspeccionar la voz desde la consola:
    //   Alertas.voces()            -> lista [{name, lang, default}]
    //   Alertas.usarVoz('Sabina')  -> fija esa voz (guarda preferencia) y la prueba
    //   Alertas.usarVoz(null)      -> vuelve a la selección automática
    function voces() {
        var lista = todasLasVoces().map(function (v) { return { name: v.name, lang: v.lang, default: !!v.default }; });
        try { console.table(lista); } catch (e) { console.log(lista); }
        return lista;
    }
    function usarVoz(nombreOParte) {
        try {
            if (nombreOParte) localStorage.setItem(LS_VOZ_PREF, String(nombreOParte));
            else localStorage.removeItem(LS_VOZ_PREF);
        } catch (e) {}
        voz = elegirVoz();
        hablar(voz ? ('Voz seleccionada: ' + (voz.name || voz.lang)) : 'Voz automática del sistema', { interrumpir: true });
        return voz ? { name: voz.name, lang: voz.lang } : null;
    }

    function hablar(texto, opts) {
        opts = opts || {};
        if (muteVoz || !texto || !('speechSynthesis' in window)) return;
        try {
            if (opts.interrumpir) window.speechSynthesis.cancel();
            var u = new SpeechSynthesisUtterance(String(texto));
            u.lang = (voz && voz.lang) || 'es-ES';
            if (voz) u.voice = voz;
            u.rate = opts.rate || 1.0;
            u.pitch = opts.pitch || 1.0;
            u.volume = (opts.volume != null) ? opts.volume : 1.0;
            window.speechSynthesis.speak(u);
        } catch (e) {}
    }

    // beep + voz (la voz entra un pelín después para no pisar el sonido)
    function notificar(tipo, texto, opts) {
        beep(tipo);
        if (texto) setTimeout(function () { hablar(texto, opts); }, 380);
    }

    // ---------- Mute + botón en el header ----------
    function guardar(k, v) { try { localStorage.setItem(k, v ? '1' : '0'); } catch (e) {} }
    function setMuteSonido(v) { muteSonido = !!v; guardar(LS_SON, muteSonido); pintarBoton(); }
    function setMuteVoz(v) { muteVoz = !!v; guardar(LS_VOZ, muteVoz); pintarBoton(); }
    function toggle() {
        var apagar = !(muteSonido && muteVoz);
        setMuteSonido(apagar); setMuteVoz(apagar);
        if (!apagar) beep('exito');
        if (typeof window.Toast !== 'undefined') {
            window.Toast.fire({ icon: apagar ? 'info' : 'success', title: apagar ? 'Alertas silenciadas' : 'Alertas activadas', timer: 1200, showConfirmButton: false });
        }
    }

    function pintarBoton() {
        var b = document.getElementById('btn-alertas-toggle');
        if (!b) return;
        var off = muteSonido && muteVoz;
        b.innerHTML = off ? '<i class="fas fa-volume-xmark"></i>' : '<i class="fas fa-volume-high"></i>';
        b.title = off ? 'Alertas silenciadas — clic para activar' : 'Alertas activas — clic para silenciar';
        b.style.color = off ? '#e74c3c' : '#27ae60';
    }

    // El botón del shell de escritorio va incrustado en la plantilla de renderShell();
    // aquí solo se monta un fallback para el header estático (pre-login).
    function montarBoton() {
        if (document.getElementById('btn-alertas-toggle')) { pintarBoton(); return; }
        var host = document.getElementById('user-session-info');
        if (!host) return;
        var b = document.createElement('button');
        b.id = 'btn-alertas-toggle';
        b.type = 'button';
        b.style.cssText = 'background:none;border:none;cursor:pointer;font-size:1rem;margin-left:12px;vertical-align:middle;padding:2px 4px;';
        b.onclick = toggle;
        host.appendChild(b);
        pintarBoton();
    }

    if (document.readyState !== 'loading') montarBoton();
    else document.addEventListener('DOMContentLoaded', montarBoton);
    setTimeout(montarBoton, 1500);   // por si el header se pinta después
    setTimeout(montarBoton, 4000);

    // Primer gesto del usuario: desbloquea el AudioContext de Chromium
    window.addEventListener('click', function unlock() { ac(); }, { once: true });

    return {
        beep: beep,
        hablar: hablar,
        notificar: notificar,
        setMuteSonido: setMuteSonido,
        setMuteVoz: setMuteVoz,
        toggle: toggle,
        voces: voces,                  // Alertas.voces()  -> lista de voces disponibles
        usarVoz: usarVoz,              // Alertas.usarVoz('Sabina') / Alertas.usarVoz(null)
        get voz() { return voz ? { name: voz.name, lang: voz.lang } : null; },
        refrescarBoton: pintarBoton,   // lo llama App.renderShell() tras pintar la topbar
        get muteSonido() { return muteSonido; },
        get muteVoz() { return muteVoz; }
    };
})();
