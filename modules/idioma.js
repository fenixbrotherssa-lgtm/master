// ============================================================
//  idioma.js — window.Idioma: traduce la interfaz sin tocar la lógica de las pantallas.
//  CasRodsoft Development
//
//  Cómo funciona: el sistema se escribe en español. Este módulo observa el DOM (MutationObserver) y
//  reemplaza el TEXTO VISIBLE (nodos de texto, placeholder, title, aria-label, value de botones) por su
//  traducción del diccionario i18n/<idioma>.json. Nunca toca: value de inputs/selects (lo que se envía al
//  servidor), textareas, código, ni lo marcado con data-no-traducir o class="notranslate".
//  Diccionario: { "texto en español": "traducción" }. Las partes variables se escriben {0}, {1}...
//  ("{0} noches": "{0} nights"). Volver a español restaura el texto original de cada nodo.
//  Idioma elegido: por equipo, en localStorage 'mh_idioma'.
// ============================================================
(function () {
    const CLAVE = 'mh_idioma';
    const IDIOMAS = [
        { cod: 'es', nombre: 'Español', bandera: 'ES' },
        { cod: 'en', nombre: 'English', bandera: 'EN' },
        { cod: 'fr', nombre: 'Français', bandera: 'FR' },
        { cod: 'pt', nombre: 'Português', bandera: 'PT' },
        { cod: 'zh', nombre: '中文', bandera: 'ZH' },
    ];
    const SALTAR = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE', 'NOSCRIPT', 'SVG', 'CANVAS']);
    const ATRIBUTOS = ['placeholder', 'title', 'aria-label'];

    let actual = 'es';
    try { actual = localStorage.getItem(CLAVE) || 'es'; } catch (e) { /* sin almacenamiento */ }
    if (!IDIOMAS.some(i => i.cod === actual)) actual = 'es';

    let exacto = new Map();          // texto normalizado → traducción
    let patrones = new Map();        // primeras 3 letras → [{ re, tr }]
    let patronesLibres = [];         // patrones que empiezan con variable
    const ORIGEN = new WeakMap();    // nodo de texto → texto original (español)
    const PUESTO = new WeakMap();    // nodo de texto → lo que escribimos nosotros
    const ATTR_ORIGEN = new WeakMap(); // elemento → { atributo: original }
    const faltantes = new Map();     // textos sin traducción vistos en pantalla (para completar el diccionario)
    let tituloOriginal = null;

    const norm = s => String(s).replace(/\s+/g, ' ').trim();
    const pareceTexto = s => /[A-Za-zÁÉÍÓÚÑáéíóúñ]{2}/.test(s);
    const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    function leerDiccionario(cod) {
        if (cod === 'es') return {};
        try {
            if (typeof require === 'function') {
                const fs = require('fs'), path = require('path');
                const ruta = path.join(__dirname, 'i18n', cod + '.json');
                if (fs.existsSync(ruta)) return JSON.parse(fs.readFileSync(ruta, 'utf8').replace(/^﻿/, ''));
            }
        } catch (e) { console.warn('[Idioma] no se pudo leer el diccionario', cod, e.message); }
        try { // móvil / navegador
            const x = new XMLHttpRequest(); x.open('GET', './i18n/' + cod + '.json', false); x.send(null);
            if (x.status === 200 || (x.status === 0 && x.responseText)) return JSON.parse(x.responseText);
        } catch (e) { /* sin diccionario */ }
        return {};
    }

    function compilar(dic) {
        exacto = new Map(); patrones = new Map(); patronesLibres = [];
        for (const [k, v] of Object.entries(dic)) {
            if (!v || typeof v !== 'string') continue;
            const kn = norm(k);
            if (!/\{\d+\}/.test(kn)) { exacto.set(kn, v); continue; }
            const partes = kn.split(/(\{\d+\})/);
            const orden = [];
            const re = new RegExp('^' + partes.map(p => { const m = p.match(/^\{(\d+)\}$/); if (m) { orden.push(+m[1]); return '(.*?)'; } return escRe(p); }).join('') + '$', 's');
            const item = { re, tr: v, orden, fijo: kn.replace(/\{\d+\}/g, '').length };
            const lit = partes[0];
            if (lit.length >= 3) {
                const b = lit.slice(0, 3).toLowerCase();
                if (!patrones.has(b)) patrones.set(b, []);
                patrones.get(b).push(item);
            } else patronesLibres.push(item);
        }
        // Primero las reglas más específicas (más texto fijo): "IVA {0} — {1} ({2}%)" antes que "IVA {0}".
        const porFijo = (a, b) => b.fijo - a.fijo;
        for (const l of patrones.values()) l.sort(porFijo);
        patronesLibres.sort(porFijo);
    }

    // Una variable es un dato (número, nombre, fecha, código), no una frase: si una variable se traga una frase
    // larga en español ("No queda cupo de este tipo la(s)"), el patrón no es el correcto y se deja el texto como está.
    function variablesSonDatos(item, m) {
        for (let i = 1; i < m.length; i++) {
            const v = (m[i] || '').trim();
            if (v.split(/\s+/).filter(w => /[a-záéíóúñ]{2}/i.test(w)).length > 5 ||/\b(de|la|el|los|las|que|para|con|por|una|del|sin|se|no)\b.*\b(de|la|el|los|las|que|para|con|por|una|del|sin|se|no)\b/i.test(v) && v.length > 25) return false;
        }
        return true;
    }

    function aplicarPatron(item, m) {
        const vals = {}; item.orden.forEach((n, i) => { vals[n] = m[i + 1]; });
        return item.tr.replace(/\{(\d+)\}/g, (_, n) => (vals[n] != null ? traducirSuelto(vals[n]) : ''));
    }
    // Una variable que en sí es un texto conocido ("Pendiente") también se traduce.
    // Si parece una palabra del sistema en español sin traducción, se anota como mezcla (para completar el diccionario).
    const mezclas = new Map();
    function traducirSuelto(v) {
        const t = exacto.get(norm(v)); if (t != null) return t;
        const n = norm(v);
        if (/^[a-záéíóúñ()]{3,}( [a-záéíóúñ()]+){0,2}$/.test(n)) mezclas.set(n, (mezclas.get(n) || 0) + 1);
        return v;
    }

    /** Traduce un texto (o devuelve null si no hay traducción). */
    function traducir(texto) {
        if (actual === 'es' || texto == null) return null;
        const n = norm(texto);
        if (!n || !pareceTexto(n)) return null;
        let t = exacto.get(n);
        if (t != null) return t;
        // "Texto:" / "Texto *" cuando el diccionario tiene "Texto"
        const m1 = n.match(/^(.*?)(\s*[:*]+)$/);
        if (m1 && (t = exacto.get(m1[1])) != null) return t + m1[2];
        // mayúsculas/minúsculas: "GUARDAR" cuando solo existe "Guardar" (y al revés)
        if (n === n.toUpperCase() && (t = buscarSinMayus(n)) != null) return t.toUpperCase();
        const lista = (patrones.get(n.slice(0, 3).toLowerCase()) || []).concat(patronesLibres).sort((a, b) => b.fijo - a.fijo);
        for (const it of lista) { const m = n.match(it.re); if (m && variablesSonDatos(it, m)) return aplicarPatron(it, m); }
        return null;
    }
    let indiceMinus = null;
    function buscarSinMayus(n) {
        if (!indiceMinus) { indiceMinus = new Map(); for (const [k, v] of exacto) { const l = k.toLowerCase(); if (!indiceMinus.has(l)) indiceMinus.set(l, v); } }
        const v = indiceMinus.get(n.toLowerCase()); return v != null ? v : null;
    }

    function excluido(el) {
        for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
            if (SALTAR.has(e.tagName)) return true;
            if (e.hasAttribute('data-no-traducir') || e.classList.contains('notranslate') || e.isContentEditable) return true;
        }
        return false;
    }

    function procesarTexto(nodo) {
        const valor = nodo.nodeValue;
        if (PUESTO.get(nodo) === valor) return;            // lo escribimos nosotros
        ORIGEN.set(nodo, valor);                            // texto nuevo de la aplicación
        if (actual === 'es') return;
        if (!valor || !pareceTexto(valor) || excluido(nodo.parentElement)) return;
        const t = traducir(valor);
        if (t == null) { anotarFaltante(valor); return; }
        const lead = valor.match(/^\s*/)[0], trail = valor.match(/\s*$/)[0];
        const nuevo = lead + t + trail;
        PUESTO.set(nodo, nuevo);
        if (nuevo !== valor) nodo.nodeValue = nuevo;
    }

    function procesarAtributos(el) {
        if (excluido(el)) return;
        let orig = ATTR_ORIGEN.get(el);
        const lista = ATRIBUTOS.slice();
        if (el.tagName === 'INPUT' && /^(button|submit|reset)$/i.test(el.type)) lista.push('value');
        for (const a of lista) {
            if (!el.hasAttribute(a)) continue;
            const v = el.getAttribute(a);
            if (!orig) { orig = {}; ATTR_ORIGEN.set(el, orig); }
            if (orig['_puesto_' + a] === v) continue;
            orig[a] = v;
            if (actual === 'es') continue;
            const t = traducir(v);
            if (t != null && t !== v) { orig['_puesto_' + a] = t; el.setAttribute(a, t); }
        }
    }

    function recorrer(raiz) {
        if (!raiz) return;
        if (raiz.nodeType === 3) { procesarTexto(raiz); return; }
        if (raiz.nodeType !== 1 && raiz.nodeType !== 11) return;
        if (raiz.nodeType === 1) { if (SALTAR.has(raiz.tagName)) return; procesarAtributos(raiz); }
        const w = document.createTreeWalker(raiz, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
        let n;
        while ((n = w.nextNode())) {
            if (n.nodeType === 3) procesarTexto(n);
            else procesarAtributos(n);
        }
    }

    function restaurarTodo() {
        const w = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
        let n;
        while ((n = w.nextNode())) {
            if (n.nodeType === 3) {
                const o = ORIGEN.get(n);
                if (o != null && PUESTO.get(n) === n.nodeValue && o !== n.nodeValue) { n.nodeValue = o; }
                PUESTO.delete(n);
            } else {
                const o = ATTR_ORIGEN.get(n);
                if (o) for (const a of Object.keys(o)) if (!a.startsWith('_puesto_') && o['_puesto_' + a] === n.getAttribute(a)) { n.setAttribute(a, o[a]); delete o['_puesto_' + a]; }
            }
        }
    }

    function anotarFaltante(v) {
        const n = norm(v);
        if (n.length < 2 || /^[\d\s$.,:%#\/()-]+$/.test(n)) return;
        if (!/[a-záéíóúñ]{3}|[A-ZÁÉÍÓÚÑ]{3}/.test(n)) return;
        faltantes.set(n, (faltantes.get(n) || 0) + 1);
    }

    // ── Fechas: toLocale*String('es-EC') sale en el idioma elegido ──
    const LOCALE = { es: null, en: 'en-US', pt: 'pt-BR', fr: 'fr-FR', de: 'de-DE', it: 'it-IT', zh: 'zh-CN' };
    ['toLocaleDateString', 'toLocaleString', 'toLocaleTimeString'].forEach(fn => {
        const orig = Date.prototype[fn];
        Date.prototype[fn] = function (loc, opts) {
            const destino = LOCALE[actual];
            if (destino && (loc == null || /^es\b/i.test(String(loc)))) loc = destino;
            return orig.call(this, loc, opts);
        };
    });

    let observador = null;
    function observar() {
        if (observador || !document.body) return;
        observador = new MutationObserver(muts => {
            for (const m of muts) {
                if (m.type === 'childList') m.addedNodes.forEach(recorrer);
                else if (m.type === 'characterData') procesarTexto(m.target);
                else if (m.type === 'attributes') procesarAtributos(m.target);
            }
            const tt = document.title;
            if (tituloOriginal == null || (tt !== tituloOriginal && tt !== traducir(tituloOriginal))) tituloOriginal = tt;
            const tr = traducir(tituloOriginal);
            if (tr && document.title !== tr) document.title = tr;
        });
        observador.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATRIBUTOS.concat(['value']) });
        recorrer(document.body);
    }

    function cambiar(cod) {
        if (!IDIOMAS.some(i => i.cod === cod)) return;
        actual = cod;
        try { localStorage.setItem(CLAVE, cod); } catch (e) { /* sin almacenamiento */ }
        indiceMinus = null;
        compilar(leerDiccionario(cod));
        document.documentElement.lang = cod;
        restaurarTodo();
        if (cod !== 'es') recorrer(document.body);
        if (tituloOriginal != null) document.title = traducir(tituloOriginal) || tituloOriginal;
        refrescarBotones();
        try { window.dispatchEvent(new CustomEvent('mh:idioma', { detail: { idioma: cod } })); } catch (e) { /* */ }
    }

    // ── Botón de idioma (topbar y login) ──
    function botonHTML(estilo) {
        const a = IDIOMAS.find(i => i.cod === actual) || IDIOMAS[0];
        return `<button type="button" class="mh-btn-idioma notranslate" data-no-traducir onclick="Idioma.menu(this)" title="Idioma / Language"
            style="${estilo || ''}"><i class="fas fa-globe"></i> <span class="mh-idioma-cod">${a.bandera}</span></button>`;
    }
    function refrescarBotones() {
        const a = IDIOMAS.find(i => i.cod === actual) || IDIOMAS[0];
        document.querySelectorAll('.mh-idioma-cod').forEach(s => { s.textContent = a.bandera; });
    }
    function menu(btn) {
        document.querySelectorAll('.mh-menu-idioma').forEach(m => m.remove());
        const r = btn.getBoundingClientRect();
        const m = document.createElement('div');
        m.className = 'mh-menu-idioma notranslate'; m.setAttribute('data-no-traducir', '');
        m.style.cssText = `position:fixed; top:${r.bottom + 6}px; left:${Math.max(8, r.right - 190)}px; width:190px; z-index:100000; background:#fff;
            border-radius:12px; box-shadow:0 10px 30px rgba(0,0,0,.18); padding:6px; font-family:inherit;`;
        m.innerHTML = IDIOMAS.map(i => `<div data-cod="${i.cod}" style="display:flex; align-items:center; gap:10px; padding:10px 12px; border-radius:8px; cursor:pointer;
            font-size:.9rem; font-weight:${i.cod === actual ? 800 : 500}; color:#2c3e50; background:${i.cod === actual ? '#eef4ff' : 'transparent'};">
            <span style="font-size:.7rem; font-weight:800; color:#007bff; width:22px;">${i.bandera}</span>${i.nombre}${i.cod === actual ? ' <i class="fas fa-check" style="margin-left:auto; color:#27ae60;"></i>' : ''}</div>`).join('');
        m.addEventListener('click', e => { const d = e.target.closest('[data-cod]'); if (d) { m.remove(); cambiar(d.dataset.cod); } });
        document.body.appendChild(m);
        setTimeout(() => document.addEventListener('click', function fuera(e) { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('click', fuera); } }), 0);
    }

    // ── Gráficos (Chart.js dibuja en un lienzo, fuera del DOM): leyendas, etiquetas y títulos ──
    function registrarGraficos() {
        if (!window.Chart || !Chart.register || registrarGraficos.hecho) return;
        registrarGraficos.hecho = true;
        const tr = s => { if (typeof s !== 'string') return s; const t = traducir(s); return t != null ? t : s; };
        Chart.register({
            id: 'mhIdioma',
            beforeUpdate(chart) {
                const d = chart.data || {};
                (d.datasets || []).forEach(ds => {
                    if (typeof ds.label === 'string') { if (ds._mhLabel !== ds.label) ds._mhEs = ds.label; ds.label = actual === 'es' ? ds._mhEs : tr(ds._mhEs); ds._mhLabel = ds.label; }
                });
                if (Array.isArray(d.labels)) {
                    if (chart._mhLabelsTr !== d.labels) chart._mhLabelsEs = d.labels;
                    d.labels = actual === 'es' ? chart._mhLabelsEs : chart._mhLabelsEs.map(tr);
                    chart._mhLabelsTr = d.labels;
                }
                const t = chart.options && chart.options.plugins && chart.options.plugins.title;
                if (t && typeof t.text === 'string') { if (t._mhTr !== t.text) t._mhEs = t.text; t.text = actual === 'es' ? t._mhEs : tr(t._mhEs); t._mhTr = t.text; }
            }
        });
    }
    registrarGraficos();
    window.addEventListener('mh:idioma', () => { try { Object.values((window.Chart && Chart.instances) || {}).forEach(c => c.update()); } catch (e) { /* */ } });

    compilar(leerDiccionario(actual));
    document.documentElement.lang = actual;
    if (document.body) observar(); else document.addEventListener('DOMContentLoaded', observar);

    window.Idioma = {
        get actual() { return actual; },
        idiomas: () => IDIOMAS.slice(),
        cambiar, traducir,
        /** t('Texto') para código que arma cadenas: devuelve la traducción o el mismo texto. */
        t: (texto) => { const r = traducir(texto); return r != null ? r : texto; },
        botonHTML, menu,
        faltantes: () => [...faltantes.entries()].sort((a, b) => b[1] - a[1]).map(x => x[0]),
        limpiarFaltantes: () => { faltantes.clear(); mezclas.clear(); },
        /** Palabras en minúscula que llegaron como variable de un patrón sin traducción (posible frase mezclada). */
        mezclas: () => [...mezclas.keys()],
    };
})();
