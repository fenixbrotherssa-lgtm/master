// modules/dashboard-movil.js
// Panel gerencial para el DUEÑO (Rol 1) en el celular.
// Reutiliza el mismo súper-endpoint del escritorio: POST /api/kpi/dashboard
// (ocupación, ADR, RevPAR, producción por área, top productos, tipos de
// alquiler y curva de ingresos). Consolida todas las sedes con sedeId = 0.
const api = require('./api');

const DashboardMovilModule = {
    charts: {},
    sedes: [],
    todasLasSedes: false,

    async init() {
        console.log("📊 Panel Gerencial Móvil iniciado...");
        this.configurarFechasPorDefecto();
        await this.cargarSedes();
        this.setupListeners();
        await this.cargar();
        window.DashboardMovilModule = this;
    },

    getUser() { return JSON.parse(localStorage.getItem('user')); },

    // Fecha local (toISOString daba el día siguiente después de las 19:00 en Ecuador)
    fmt(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; },

    configurarFechasPorDefecto() { this.periodo('mes', false); },

    // Chips de período (2.4.1): hoy / 7 días / este mes / mes anterior; "Filtros" abre sede y rango
    periodo(p, cargar = true) {
        const hoy = new Date();
        let desde = new Date(hoy), hasta = new Date(hoy);
        if (p === '7d') desde.setDate(hoy.getDate() - 6);
        else if (p === 'mes') desde = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
        else if (p === 'mesant') { desde = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1); hasta = new Date(hoy.getFullYear(), hoy.getMonth(), 0); }
        const inIni = document.getElementById('dash-fecha-inicio');
        const inFin = document.getElementById('dash-fecha-fin');
        if (inIni) inIni.value = this.fmt(desde);
        if (inFin) inFin.value = this.fmt(hasta);
        document.querySelectorAll('#dash-chips .dash-chip').forEach(b => b.classList.toggle('on', b.dataset.periodo === p));
        if (cargar) this.cargar();
    },

    async cargarSedes() {
        const sel = document.getElementById('dash-sede');
        try {
            const res = await api.get('/admin/sedes');
            this.sedes = res.data || [];
            if (sel) {
                sel.innerHTML = this.sedes.map(s =>
                    `<option value="${s.SedeID}">${(s.NombreComercial || 'Sede').toUpperCase()}</option>`
                ).join('');
                const actual = localStorage.getItem('currentSedeId') || (this.getUser() ? this.getUser().SedeID : null);
                if (actual) sel.value = actual;
            }
        } catch (e) {
            // Si no puede listar sedes (p.ej. no es admin), igual funciona con su sede
            console.warn("No se pudieron cargar sedes:", e.message);
        }
    },

    getSedeId() {
        if (this.todasLasSedes) return 0;
        const sel = document.getElementById('dash-sede');
        if (sel && sel.value) return sel.value;
        const u = this.getUser();
        return localStorage.getItem('currentSedeId') || (u ? u.SedeID : 1);
    },

    setupListeners() {
        document.querySelectorAll('#dash-chips .dash-chip').forEach(b => b.onclick = () => {
            if (b.dataset.periodo === 'filtros') {
                const f = document.getElementById('dash-filtros');
                if (f) f.classList.toggle('on');
                b.classList.toggle('on', f && f.classList.contains('on'));
                return;
            }
            this.periodo(b.dataset.periodo);
        });

        const btn = document.getElementById('dash-aplicar');
        if (btn) btn.onclick = () => {
            document.querySelectorAll('#dash-chips .dash-chip').forEach(b => b.classList.toggle('on', b.dataset.periodo === 'filtros'));
            this.cargar();
        };

        const sel = document.getElementById('dash-sede');
        if (sel) sel.onchange = () => { if (!this.todasLasSedes) this.cargar(); };

        const chk = document.getElementById('dash-todas');
        if (chk) chk.onchange = (e) => {
            this.todasLasSedes = e.target.checked;
            const wrap = document.getElementById('dash-sede-wrap');
            if (wrap) wrap.style.opacity = this.todasLasSedes ? '0.4' : '1';
            if (sel) sel.disabled = this.todasLasSedes;
            this.cargar();
        };
    },

    money(n) { return '$' + (parseFloat(n) || 0).toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); },
    setText(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; },

    async cargar() {
        const load = document.getElementById('dash-loading');
        if (load) load.style.display = 'block';
        try {
            const sedeId = this.getSedeId();
            const fechaInicio = document.getElementById('dash-fecha-inicio')?.value;
            const fechaFin = document.getElementById('dash-fecha-fin')?.value;

            const res = await api.post('/kpi/dashboard', { sedeId, fechaInicio, fechaFin });
            if (!res.data || !res.data.success) throw new Error('Respuesta inválida');
            this.pintar(res.data);
        } catch (err) {
            console.error("Error cargando panel móvil:", err.response?.data || err.message);
            if (window.Toast) window.Toast.fire({ icon: 'error', title: 'No se pudo cargar el panel' });
        } finally {
            if (load) load.style.display = 'none';
        }
    },

    pintar(data) {
        const m = data.metricasHoteleras || {};
        const p = data.produccionAreas || {};

        const ocu = Math.max(0, Math.min(100, Math.round(m.OcupacionPorcentaje || 0)));
        this.setText('dash-ocupacion', `${ocu}%`);
        const anillo = document.getElementById('dash-anillo');
        if (anillo) anillo.style.setProperty('--p', ocu);
        this.setText('dash-tienda', this.money(p.TiendaRestaurante));
        this.setText('dash-parqueo-sub', `Parqueo ${this.money(p.Parqueadero)}`);
        const ini = document.getElementById('dash-fecha-inicio')?.value, fin = document.getElementById('dash-fecha-fin')?.value;
        if (ini && fin) {
            const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
            const f = s => { const [y, mm, d] = s.split('-').map(Number); return `${d} ${MES[mm - 1]}`; };
            const todas = this.todasLasSedes ? ' · todas las sedes' : '';
            this.setText('dash-rango-txt', (ini === fin ? f(ini) : `${f(ini)} — ${f(fin)}`) + todas);
        }
        this.setText('dash-ocupacion-sub', `${m.HabitacionesOcupadas || 0} / ${m.TotalHabitaciones || 0} hab.`);
        this.setText('dash-total', this.money(p.TotalGlobal));
        this.setText('dash-hospedaje', this.money(m.IngresoHospedaje));
        this.setText('dash-adr', this.money(m.ADR));
        this.setText('dash-revpar', this.money(m.RevPAR));

        this.dona('dash-chart-areas', {
            labels: ['Hospedaje', 'Tienda/Rest.', 'Parqueo'],
            valores: [p.Hospedaje || 0, p.TiendaRestaurante || 0, p.Parqueadero || 0],
            colores: ['#1a365d', '#10b981', '#c5a059']
        });

        const curva = data.curvaIngresos || [];
        this.linea('dash-chart-curva', {
            labels: curva.map(c => c.Fecha),
            valores: curva.map(c => parseFloat(c.TotalDia) || 0)
        });

        const top = data.topProductos || [];
        this.barras('dash-chart-top', {
            labels: top.map(t => t.Nombre),
            valores: top.map(t => parseFloat(t.TotalGenerado) || 0)
        });

        const tbody = document.getElementById('dash-alquiler-body');
        if (tbody) {
            const tipos = data.tiposAlquiler || [];
            tbody.innerHTML = tipos.length === 0
                ? `<tr><td colspan="3" style="text-align:center; opacity:0.5; padding:14px;">Sin datos</td></tr>`
                : tipos.map(t => `
                    <tr>
                        <td style="font-weight:700; color:#0f172a;">${t.TipoAlquiler || '-'}</td>
                        <td style="text-align:center;">${t.Cantidad || 0}</td>
                        <td style="text-align:right; font-weight:800; color:#059669;">${this.money(t.Ingreso)}</td>
                    </tr>`).join('');
        }
    },

    _destruir(id) { if (this.charts[id]) { this.charts[id].destroy(); delete this.charts[id]; } },

    dona(id, { labels, valores, colores }) {
        const cv = document.getElementById(id);
        if (!cv || typeof Chart === 'undefined') return;
        this._destruir(id);
        const cero = valores.every(v => !v);
        this.charts[id] = new Chart(cv.getContext('2d'), {
            type: 'doughnut',
            data: { labels, datasets: [{ data: cero ? [1, 1, 1] : valores, backgroundColor: cero ? ['#e2e8f0', '#e2e8f0', '#e2e8f0'] : colores, borderWidth: 0, spacing: 3, borderRadius: 6 }] },
            options: {
                responsive: true, maintainAspectRatio: false, cutout: '68%',
                plugins: {
                    legend: { position: 'bottom', labels: { font: { weight: '700', size: 10 }, padding: 10 } },
                    tooltip: { callbacks: { label: (c) => `${c.label}: ${this.money(cero ? 0 : c.parsed)}` } }
                }
            }
        });
    },

    linea(id, { labels, valores }) {
        const cv = document.getElementById(id);
        if (!cv || typeof Chart === 'undefined') return;
        this._destruir(id);
        this.charts[id] = new Chart(cv.getContext('2d'), {
            type: 'line',
            data: { labels, datasets: [{ data: valores, borderColor: '#1a365d', backgroundColor: (ctx) => {
                const a = ctx.chart.chartArea; if (!a) return 'rgba(26,54,93,0.08)';
                const g = ctx.chart.ctx.createLinearGradient(0, a.top, 0, a.bottom);
                g.addColorStop(0, 'rgba(59,111,176,0.35)'); g.addColorStop(1, 'rgba(59,111,176,0)'); return g;
            }, fill: true, tension: 0.4, pointRadius: 0, pointHitRadius: 12, borderWidth: 2.5 }] },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => this.money(c.parsed.y) } } },
                scales: { y: { grid: { color: 'rgba(15,23,42,.05)' }, border: { display: false }, ticks: { callback: (v) => '$' + v, font: { size: 9 }, color: '#94a3b8' } },
                          x: { grid: { display: false }, ticks: { font: { size: 8 }, color: '#94a3b8', maxRotation: 0, autoSkip: true, maxTicksLimit: 7 } } }
            }
        });
    },

    barras(id, { labels, valores }) {
        const cv = document.getElementById(id);
        if (!cv || typeof Chart === 'undefined') return;
        this._destruir(id);
        this.charts[id] = new Chart(cv.getContext('2d'), {
            type: 'bar',
            data: { labels, datasets: [{ data: valores, backgroundColor: '#10b981', borderRadius: 8, barThickness: 16 }] },
            options: {
                indexAxis: 'y', responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => this.money(c.parsed.x) } } },
                scales: { x: { grid: { color: 'rgba(15,23,42,.05)' }, border: { display: false }, ticks: { callback: (v) => '$' + v, font: { size: 9 }, color: '#94a3b8' } },
                          y: { grid: { display: false }, border: { display: false }, ticks: { font: { size: 10, weight: '600' }, color: '#334155' } } }
            }
        });
    }
};

module.exports = DashboardMovilModule;
