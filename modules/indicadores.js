// indicadores.js — Tablero gerencial (Fase 7): ocupación, ADR, RevPAR, TRevPAR, GOP, GOPPAR, CPOR,
// food cost; comparación con el periodo anterior, el año anterior y las metas; resultado por centro
// (USALI); tendencia de 12 meses; canales y pronóstico; metas mensuales. Solo el administrador
// (/api/indicadores/...). Todo se calcula en el servidor (services/indicadoresService.js).
const api = require('./api');

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => n == null || !isFinite(n) ? '—' : '$' + Number(n).toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = n => n == null || !isFinite(n) ? '—' : `${Number(n).toLocaleString('es-EC', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
const errMsg = e => (e && e.response && e.response.data && (e.response.data.error || e.response.data.message)) || (e && e.message) || 'Error';
const hoyISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

// Indicadores de las tarjetas. `alto`: true = más es mejor (para el color de la variación y la meta).
const KPIS = [
    { k: 'ocupacion', t: 'Ocupación', f: pct, meta: 'OCUPACION', alto: true, v: d => d.ocupacion },
    { k: 'adr', t: 'ADR (tarifa promedio)', f: money, meta: 'ADR', alto: true, v: d => d.adr },
    { k: 'revpar', t: 'RevPAR', f: money, meta: 'REVPAR', alto: true, v: d => d.revpar },
    { k: 'trevpar', t: 'TRevPAR', f: money, meta: 'TREVPAR', alto: true, v: d => d.trevpar },
    { k: 'total', t: 'Ingreso total', f: money, meta: 'INGRESO_TOTAL', alto: true, v: d => d.ingresos && d.ingresos.total },
    { k: 'gop', t: 'GOP', f: money, meta: 'GOP', alto: true, v: d => d.gop, extra: d => d.gopPct != null ? `${pct(d.gopPct)} del ingreso` : '' },
    { k: 'goppar', t: 'GOPPAR', f: money, meta: 'GOPPAR', alto: true, v: d => d.goppar },
    { k: 'cpor', t: 'CPOR (costo por hab. ocupada)', f: money, meta: 'CPOR', alto: false, v: d => d.cpor },
    { k: 'food', t: 'Food cost', f: pct, meta: 'FOOD_COST', alto: false, v: d => d.foodCost },
];
const NOMBRES_META = { OCUPACION: 'Ocupación %', ADR: 'ADR $', REVPAR: 'RevPAR $', TREVPAR: 'TRevPAR $', INGRESO_TOTAL: 'Ingreso $', GOP: 'GOP $', GOPPAR: 'GOPPAR $', CPOR: 'CPOR $', FOOD_COST: 'Food cost %' };

const IndicadoresModule = {
    datos: null,
    graficos: {},
    _cargado: {},

    async init() {
        window.IndicadoresModule = this;
        window.backView = 'dashboard';
        const sel = document.getElementById('ind-metas-anio');
        const y = new Date().getFullYear();
        sel.innerHTML = [y + 1, y, y - 1, y - 2].map(a => `<option value="${a}" ${a === y ? 'selected' : ''}>${a}</option>`).join('');
        App.renderSedeSelector('sedeSelectorInd', () => { this._cargado = {}; this.cargar(); });
        this.preset('mes');
    },

    getSedeId() {
        const sel = document.getElementById('globalSedeSelector');
        return sel ? sel.value : (localStorage.getItem('currentSedeId') || App.user.SedeID);
    },

    preset(p) {
        const hoy = hoyISO(), [y, m] = hoy.split('-').map(Number);
        const pad = n => String(n).padStart(2, '0');
        let d, h = hoy;
        if (p === 'mes') d = `${y}-${pad(m)}-01`;
        else if (p === 'anterior') { const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1; d = `${py}-${pad(pm)}-01`; h = `${py}-${pad(pm)}-${pad(new Date(py, pm, 0).getDate())}`; }
        else if (p === '30') { const f = new Date(); f.setDate(f.getDate() - 29); d = new Date(f.getTime() - f.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
        else d = `${y}-01-01`;
        document.getElementById('ind-desde').value = d;
        document.getElementById('ind-hasta').value = h;
        document.querySelectorAll('#seccion-ind [data-pre]').forEach(b => b.classList.toggle('sel', b.dataset.pre === p));
        this.cargar();
    },

    rango() { return { desde: document.getElementById('ind-desde').value, hasta: document.getElementById('ind-hasta').value }; },

    tab(nombre) {
        document.querySelectorAll('#seccion-ind .cc-tab').forEach(b => b.classList.toggle('activa', b.dataset.tab === nombre));
        document.querySelectorAll('#seccion-ind .cc-tabpanel').forEach(p => p.style.display = p.dataset.panel === nombre ? '' : 'none');
        this._tab = nombre;
        if (nombre === 'tendencia' && !this._cargado.tendencia) this.cargarTendencia();
        if (nombre === 'canales' && !this._cargado.canales) this.cargarCanales();
        if (nombre === 'metas' && !this._cargado.metas) this.cargarMetas();
    },

    async cargar() {
        const { desde, hasta } = this.rango();
        if (!desde || !hasta || desde > hasta) return Swal.fire({ icon: 'warning', title: 'Revise las fechas', confirmButtonColor: '#1a365d' });
        this._cargado = {};
        document.getElementById('ind-kpis').innerHTML = '<div class="vacio"><i class="fas fa-spinner fa-spin"></i> Calculando…</div>';
        try {
            const { data } = await api.get(`/indicadores/resumen/${this.getSedeId()}`, { params: { desde, hasta } });
            this.datos = data;
            this.pintarResumen();
            this.pintarCentros();
            if (this._tab && this._tab !== 'resumen' && this._tab !== 'centros') this.tab(this._tab);
        } catch (e) {
            document.getElementById('ind-kpis').innerHTML = `<div class="vacio">${esc(errMsg(e))}</div>`;
        }
    },

    variacion(act, ant, alto) {
        if (act == null || ant == null || !isFinite(act) || !isFinite(ant) || ant === 0) return '<span class="muted">—</span>';
        const v = (act - ant) * 100 / Math.abs(ant);
        const bueno = alto ? v >= 0 : v <= 0;
        return `<span class="${bueno ? 'sube' : 'baja'}">${v >= 0 ? '▲' : '▼'} ${Math.abs(v).toFixed(1)}%</span>`;
    },

    pintarResumen() {
        const d = this.datos, a = d.actual;
        const base = a.base === 'CONTABLE'
            ? '<span class="badge b-ok" title="GOP calculado desde los asientos contables">GOP CONTABLE</span>'
            : '<span class="badge b-medio" title="Sin contabilidad iniciada en todo el periodo: GOP estimado con caja y costo de lo consumido">GOP ESTIMADO (CAJA)</span>';
        document.getElementById('ind-base').innerHTML = `${base} ${d.ivaDescontado ? '<span class="badge b-gris">VALORES SIN IVA</span>' : ''}`;
        const avisos = [];
        const sc = d.resultado.sinCentro;
        if (sc && (sc.ingresos || sc.gastos)) avisos.push(`Hay ${money(sc.ingresos)} de ingresos y ${money(sc.gastos)} de gastos sin centro de costo: el resultado por centro está incompleto. <a href="#" onclick="App.renderView('configsede','viewport');return false;">Clasificarlos</a>.`);
        if (d.contabilidad && d.contabilidad.errores) avisos.push(`La contabilidad tiene ${d.contabilidad.errores} documento(s) sin contabilizar: revise Contabilidad → Estado.`);
        if (a.base === 'CONTABLE' && d.hasta >= hoyISO()) avisos.push('La contabilidad llega hasta ayer: el GOP no incluye el día de hoy.');
        document.getElementById('ind-avisos').innerHTML = avisos.map(x => `<div class="aviso"><i class="fas fa-triangle-exclamation"></i> ${x}</div>`).join('');

        document.getElementById('ind-kpis').innerHTML = KPIS.map(k => {
            const act = k.v(a), ant = k.v(d.anterior), ly = k.v(d.anioAnterior);
            const meta = d.metas[k.meta];
            let metaHtml = '';
            if (meta && act != null) {
                const prog = k.alto ? (meta.valor ? act / meta.valor : 0) : (act ? meta.valor / act : 0);
                metaHtml = `<div class="cmp"><span>Meta ${k.f(meta.valor)}${meta.completa ? '' : '*'}</span><span class="${prog >= 1 ? 'sube' : 'baja'}">${prog >= 2 ? '✔ cumplida' : (prog * 100).toFixed(0) + '%'}</span></div>
                            <div class="meta"><i style="width:${Math.min(100, Math.max(0, prog * 100)).toFixed(0)}%; background:${prog >= 1 ? '#27ae60' : prog >= .85 ? '#f39c12' : '#e74c3c'}"></i></div>`;
            }
            return `<div class="kpi">
                <div class="t"><span>${k.t}</span></div>
                <div class="v">${k.f(act)}</div>
                ${k.extra ? `<div class="muted">${k.extra(a)}</div>` : ''}
                <div class="cmp"><span>vs periodo anterior</span>${this.variacion(act, ant, k.alto)}</div>
                <div class="cmp"><span>vs año anterior</span>${this.variacion(act, ly, k.alto)}</div>
                ${metaHtml}
            </div>`;
        }).join('') + `<div class="kpi"><div class="t"><span>Movimiento</span></div>
            <div class="cmp" style="margin-top:8px;"><span>Noches vendidas</span><b>${a.noches}</b></div>
            <div class="cmp"><span>Momentos</span><b>${a.momentos}</b></div>
            <div class="cmp"><span>Llegadas / salidas</span><b>${a.llegadas} / ${a.salidas}</b></div>
            <div class="cmp"><span>No-show / cancelaciones</span><b>${a.noShows} / ${a.cancelaciones}</b></div>
            <div class="cmp"><span>Hab. disponibles × días</span><b>${a.habitaciones} × ${a.dias}</b></div></div>`;

        const ing = a.ingresos;
        const filas = [['Habitaciones (estadías)', ing.habitaciones], ['Momentos', ing.momentos], ['Alimentos y bebidas', ing.ayb], ['Eventos y salones', ing.eventos], ['Parqueadero', ing.parqueadero]];
        document.getElementById('ind-iva-nota').textContent = d.ivaDescontado ? 'Producción del periodo, sin IVA. Los eventos cuentan el día en que ocurren.' : 'Producción del periodo. Los eventos cuentan el día en que ocurren.';
        document.getElementById('ind-areas').innerHTML = `<table><tbody>${filas.map(([n, v]) => `<tr><td>${n}</td><td class="num">${money(v)}</td>
            <td class="num muted">${ing.total ? pct(v * 100 / ing.total) : ''}</td></tr>`).join('')}
            <tr class="total"><td>Total</td><td class="num">${money(ing.total)}</td><td></td></tr></tbody></table>
            <p class="muted" style="margin-top:10px;">Cobrado en caja en el periodo: <b>${money(a.cobros)}</b> · Egresos: <b>${money(a.egresos)}</b></p>`;

        this.grafico('dias', 'ind-graf-dias', {
            type: 'bar',
            data: { labels: d.porDia.map(x => x.Dia.slice(5).split('-').reverse().join('/')), datasets: [
                { type: 'bar', label: 'Ocupación %', data: d.porDia.map(x => x.ocupacion), backgroundColor: 'rgba(26,54,93,.55)', yAxisID: 'y' },
                { type: 'line', label: 'RevPAR $', data: d.porDia.map(x => x.revpar), borderColor: '#c5a059', backgroundColor: '#c5a059', tension: .3, yAxisID: 'y1', pointRadius: 2 },
            ] },
            options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
                scales: { y: { beginAtZero: true, max: 100, title: { display: true, text: '%' } }, y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: '$' } } } },
        });
    },

    pintarCentros() {
        const r = this.datos.resultado;
        document.getElementById('ind-centros-ayuda').innerHTML = r.base === 'CONTABLE'
            ? 'Desde los asientos contables del periodo (ingresos y gastos por centro). La depreciación va debajo del GOP, como pide USALI.'
            : 'Estimado en base caja: ingresos cobrados por centro, egresos que son gasto y el costo de lo que salió del inventario (A&B, kits de habitación, mantenimiento, eventos). Las compras de inventario no se cuentan dos veces. Inicie la contabilidad para tener el resultado devengado.';
        const fila = c => `<tr><td>${esc(c.Codigo)} · ${esc(c.Nombre)}</td><td class="num">${money(c.Ingresos)}</td><td class="num">${money(c.Gastos)}</td>
            <td class="num" style="font-weight:800; color:${c.Resultado < 0 ? '#b03a2e' : '#1e8449'}">${money(c.Resultado)}</td>
            <td class="num muted">${c.Ingresos ? pct(c.Resultado * 100 / c.Ingresos) : '—'}</td></tr>`;
        const oper = r.centros.filter(c => c.Tipo === 'OPERATIVO'), nd = r.centros.filter(c => c.Tipo === 'NO_DISTRIBUIDO'), sc = r.centros.filter(c => c.Tipo === 'NINGUNO');
        document.getElementById('ind-centros').innerHTML = `<table>
            <thead><tr><th>Centro</th><th class="num">Ingresos</th><th class="num">Costos y gastos</th><th class="num">Resultado</th><th class="num">Margen</th></tr></thead>
            <tbody>
                <tr class="sub"><td colspan="5">Departamentos operativos</td></tr>${oper.map(fila).join('')}
                <tr class="total"><td>Resultado departamental</td><td></td><td></td><td class="num">${money(r.resultadoDepartamental)}</td><td></td></tr>
                <tr class="sub"><td colspan="5">Gastos no distribuidos</td></tr>${nd.map(fila).join('')}
                ${sc.length ? `<tr class="sub"><td colspan="5" style="color:#b9770e;">Sin centro de costo (clasifíquelos en Configuración)</td></tr>${sc.map(fila).join('')}` : ''}
                <tr class="total"><td>GOP (resultado bruto de operación)</td><td class="num">${money(r.ingresos)}</td><td class="num">${money(r.gastos)}</td><td class="num">${money(r.gop)}</td>
                    <td class="num">${r.ingresos ? pct(r.gop * 100 / r.ingresos) : '—'}</td></tr>
                ${r.base === 'CONTABLE' ? `<tr><td class="muted">Depreciación (debajo del GOP)</td><td></td><td class="num muted">${money(r.depreciacion)}</td><td class="num muted">${money(r.gop - r.depreciacion)}</td><td></td></tr>` : ''}
            </tbody></table>`;
    },

    async cargarTendencia() {
        const cont = document.getElementById('ind-tend');
        cont.innerHTML = '<div class="vacio"><i class="fas fa-spinner fa-spin"></i> Calculando 12 meses…</div>';
        try {
            const { data } = await api.get(`/indicadores/tendencia/${this.getSedeId()}`, { params: { hasta: this.rango().hasta, meses: 12 } });
            this._cargado.tendencia = true;
            const lab = data.map(m => `${MESES[parseInt(m.mes.slice(5), 10) - 1]} ${m.mes.slice(2, 4)}`);
            this.grafico('tend', 'ind-graf-tend', {
                type: 'bar',
                data: { labels: lab, datasets: [
                    { type: 'bar', label: 'Ocupación %', data: data.map(m => m.ocupacion), backgroundColor: 'rgba(26,54,93,.5)', yAxisID: 'y' },
                    { type: 'line', label: 'ADR $', data: data.map(m => m.adr), borderColor: '#c5a059', backgroundColor: '#c5a059', tension: .3, yAxisID: 'y1' },
                    { type: 'line', label: 'RevPAR $', data: data.map(m => m.revpar), borderColor: '#27ae60', backgroundColor: '#27ae60', tension: .3, yAxisID: 'y1' },
                    { type: 'line', label: 'GOPPAR $', data: data.map(m => m.goppar), borderColor: '#8e44ad', backgroundColor: '#8e44ad', tension: .3, yAxisID: 'y1', borderDash: [5, 4] },
                ] },
                options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
                    scales: { y: { beginAtZero: true, max: 100 }, y1: { position: 'right', grid: { drawOnChartArea: false } } } },
            });
            cont.innerHTML = `<table><thead><tr><th>Mes</th><th class="num">Ocupación</th><th class="num">ADR</th><th class="num">RevPAR</th><th class="num">TRevPAR</th>
                <th class="num">Ingreso</th><th class="num">GOP</th><th class="num">GOPPAR</th><th class="num">Food cost</th><th>Base</th></tr></thead><tbody>
                ${data.map((m, i) => `<tr><td>${lab[i]}</td><td class="num">${pct(m.ocupacion)}</td><td class="num">${money(m.adr)}</td><td class="num">${money(m.revpar)}</td>
                    <td class="num">${money(m.trevpar)}</td><td class="num">${money(m.ingreso)}</td><td class="num">${money(m.gop)}</td><td class="num">${money(m.goppar)}</td>
                    <td class="num">${pct(m.foodCost)}</td><td><span class="badge ${m.base === 'CONTABLE' ? 'b-ok' : 'b-medio'}">${m.base === 'CONTABLE' ? 'Contable' : 'Caja'}</span></td></tr>`).join('')}
                </tbody></table>`;
        } catch (e) { cont.innerHTML = `<div class="vacio">${esc(errMsg(e))}</div>`; }
    },

    async cargarCanales() {
        const cont = document.getElementById('ind-canales');
        cont.innerHTML = '<div class="vacio"><i class="fas fa-spinner fa-spin"></i></div>';
        try {
            const [can, pron] = await Promise.all([
                api.get(`/indicadores/canales/${this.getSedeId()}`, { params: this.rango() }),
                api.get(`/indicadores/pronostico/${this.getSedeId()}`, { params: { dias: 30 } }),
            ]);
            this._cargado.canales = true;
            const filas = can.data, tot = filas.reduce((a, c) => a + c.IngresoNeto, 0);
            cont.innerHTML = filas.length ? `<table><thead><tr><th>Canal</th><th class="num">Reservas / estadías</th><th class="num">Noches</th><th class="num">Ingreso</th>
                <th class="num">Comisión</th><th class="num">Ingreso neto</th><th class="num">ADR neto</th><th class="num">Participación</th><th class="num">No-show / cancel.</th></tr></thead><tbody>
                ${filas.map(c => `<tr><td><b>${esc(c.Nombre)}</b>${c.ComisionPct ? ` <span class="muted">(${c.ComisionPct}%)</span>` : ''}</td><td class="num">${c.Reservas}</td><td class="num">${c.Noches}</td>
                    <td class="num">${money(c.Ingreso)}</td><td class="num" style="color:#b03a2e;">${c.Comision ? '−' + money(c.Comision) : '—'}</td><td class="num"><b>${money(c.IngresoNeto)}</b></td>
                    <td class="num">${money(c.ADRNeto)}</td><td class="num">${tot ? pct(c.IngresoNeto * 100 / tot) : '—'}</td><td class="num">${c.NoShows} / ${c.Canceladas}</td></tr>`).join('')}
                </tbody></table>` : '<div class="vacio">Sin estadías en el periodo.</div>';
            const p = pron.data;
            this.grafico('pron', 'ind-graf-pron', {
                type: 'bar',
                data: { labels: p.map(x => x.Dia.slice(5).split('-').reverse().join('/')), datasets: [
                    { type: 'bar', label: 'Comprometida %', data: p.map(x => x.Ocupacion), backgroundColor: p.map(x => x.Historica != null && x.Ocupacion + 15 < x.Historica ? 'rgba(231,76,60,.55)' : 'rgba(26,54,93,.55)') },
                    { type: 'line', label: 'Histórica mismo día %', data: p.map(x => x.Historica), borderColor: '#c5a059', backgroundColor: '#c5a059', tension: .3 },
                ] },
                options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, scales: { y: { beginAtZero: true, max: 100 } } },
            });
        } catch (e) { cont.innerHTML = `<div class="vacio">${esc(errMsg(e))}</div>`; }
    },

    async cargarMetas() {
        const cont = document.getElementById('ind-metas');
        const anio = document.getElementById('ind-metas-anio').value;
        cont.innerHTML = '<div class="vacio"><i class="fas fa-spinner fa-spin"></i></div>';
        try {
            const { data } = await api.get(`/indicadores/metas/${this.getSedeId()}`, { params: { anio } });
            this._cargado.metas = true;
            const val = (p, c) => { const m = data.metas.find(x => x.Periodo === p && x.Clave === c); return m ? m.Valor : ''; };
            cont.innerHTML = `<table><thead><tr><th>Mes</th>${data.claves.map(c => `<th class="num">${NOMBRES_META[c] || c}</th>`).join('')}<th></th></tr></thead><tbody>
                ${MESES.map((m, i) => { const p = `${anio}-${String(i + 1).padStart(2, '0')}`;
                    return `<tr data-periodo="${p}"><td><b>${m}</b></td>${data.claves.map(c => `<td class="num"><input type="number" min="0" step="0.01" data-clave="${c}" value="${val(p, c)}"></td>`).join('')}
                    <td><button class="cc-btn mini primary" onclick="IndicadoresModule.guardarMeta('${p}')"><i class="fas fa-save"></i></button></td></tr>`; }).join('')}
                </tbody></table>`;
        } catch (e) { cont.innerHTML = `<div class="vacio">${esc(errMsg(e))}</div>`; }
    },

    async guardarMeta(periodo) {
        const tr = document.querySelector(`#ind-metas tr[data-periodo="${periodo}"]`);
        const valores = {};
        tr.querySelectorAll('input[data-clave]').forEach(i => { valores[i.dataset.clave] = i.value === '' ? null : Number(i.value); });
        try {
            await api.put('/indicadores/metas', { SedeID: this.getSedeId(), Periodo: periodo, valores });
            Swal.fire({ icon: 'success', title: 'Metas guardadas', toast: true, position: 'top-end', timer: 1800, showConfirmButton: false });
            this.cargar();
        } catch (e) { Swal.fire({ icon: 'error', title: 'No se guardó', text: errMsg(e), confirmButtonColor: '#1a365d' }); }
    },

    grafico(clave, canvasId, config) {
        if (this.graficos[clave]) { try { this.graficos[clave].destroy(); } catch (_) { /* */ } }
        const cv = document.getElementById(canvasId);
        if (!cv || typeof Chart === 'undefined') return;
        this.graficos[clave] = new Chart(cv.getContext('2d'), config);
    },
};

module.exports = IndicadoresModule;
