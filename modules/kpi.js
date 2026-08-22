const api = require('./api');

const KpiModule = {
    charts: {},
    _fi: null, _ff: null, _sedeId: null, _lastData: null,

    async init() {
        this.configurarFechasDefault();
        this.renderSedeSelector();
        window.KpiModule = this;
        setTimeout(() => this.cargarMetricas(), 150);
    },

    renderSedeSelector() {
        App.renderSedeSelector('sedeSelectorKPI', () => this.cargarMetricas());
    },

    getSedeId() {
        const sel = document.getElementById('globalSedeSelector');
        return sel ? sel.value : (App.user ? App.user.SedeID : 1);
    },

    configurarFechasDefault() {
        const hoy = new Date();
        const y = hoy.getFullYear();
        const m = String(hoy.getMonth() + 1).padStart(2, '0');
        const d = String(hoy.getDate()).padStart(2, '0');
        document.getElementById('fechaInicioKPI').value = `${y}-${m}-01`;
        document.getElementById('fechaFinKPI').value    = `${y}-${m}-${d}`;
    },

    async cargarMetricas() {
        this._sedeId = this.getSedeId();
        this._fi     = document.getElementById('fechaInicioKPI').value;
        this._ff     = document.getElementById('fechaFinKPI').value;

        try {
            Swal.fire({ title: 'Calculando métricas...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
            const res = await api.post('/kpi/dashboard', { sedeId: this._sedeId, fechaInicio: this._fi, fechaFin: this._ff });
            Swal.close();

            const d = res.data;
            if (!d.success) throw new Error('Sin datos');
            this._lastData = d;

            this._poblarKpisprincipales(d.metricasHoteleras, d.produccionAreas);
            this._poblarKpisSecundarios(d.metricasAdicionales, d.metricasHoteleras);
            this._dibujarCurvaTendencia(d.curvaIngresos);
            this._dibujarDonaAreas(d.produccionAreas);
            this._dibujarBarrasTop(d.topProductos);
            this._dibujarPastelModalidad(d.tiposAlquiler);
            this._dibujarTipoHab(d.porTipoHabitacion);
            this._dibujarProcedencia(d.procedencia);
            this._dibujarDiaSemana(d.porDiaSemana);

        } catch (err) {
            Swal.fire('Error', 'No se pudieron cargar las métricas.', 'error');
            console.error(err);
        }
    },

    // ── KPIs ────────────────────────────────────────────────────────────

    _poblarKpisprincipales(mh, pa) {
        document.getElementById('kpi-ocupacion').textContent     = `${parseFloat(mh.OcupacionPorcentaje||0).toFixed(2)} %`;
        document.getElementById('kpi-habs-text').textContent     = `${mh.HabitacionesOcupadas||0} / ${mh.TotalHabitaciones||0} habitaciones`;
        document.getElementById('kpi-adr').textContent           = `$ ${parseFloat(mh.ADR||0).toFixed(2)}`;
        document.getElementById('kpi-revpar').textContent        = `$ ${parseFloat(mh.RevPAR||0).toFixed(2)}`;
        document.getElementById('kpi-prod-hospedaje').textContent = `$ ${parseFloat(mh.IngresoHospedaje||0).toFixed(2)}`;
    },

    _poblarKpisSecundarios(ma, mh) {
        const horas  = parseFloat(ma.EstadiaPromHoras || 0);
        const dias   = horas > 0 ? (horas / 24).toFixed(1) : '--';
        document.getElementById('kpi-estadia').textContent        = `${dias} días`;
        document.getElementById('kpi-clientes-unicos').textContent = ma.ClientesUnicos ?? '--';
        document.getElementById('kpi-cartera').textContent        = `$ ${parseFloat(ma.CarteraPendiente||0).toFixed(2)}`;

        const actual  = parseFloat(mh.IngresoHospedaje || 0);
        const previo  = parseFloat(ma.IngresoPeriodoAnterior || 0);
        const el      = document.getElementById('kpi-variacion');
        if (previo > 0) {
            const pct = ((actual - previo) / previo * 100).toFixed(1);
            const positivo = parseFloat(pct) >= 0;
            el.textContent  = `${positivo ? '+' : ''}${pct}%`;
            el.className    = positivo ? 'variacion-pos' : 'variacion-neg';
        } else {
            el.textContent = 'N/D';
            el.className   = '';
        }
    },

    // ── GRÁFICAS EXISTENTES ─────────────────────────────────────────────

    _dibujarCurvaTendencia(datos) {
        const ctx = document.getElementById('chartCurvaIngresos').getContext('2d');
        if (this.charts.curva) this.charts.curva.destroy();
        const labels  = datos.map(x => x.Fecha);
        const valores = datos.map(x => parseFloat(x.TotalDia));
        let grad = ctx.createLinearGradient(0, 0, 0, 280);
        grad.addColorStop(0, 'rgba(26,54,93,0.4)');
        grad.addColorStop(1, 'rgba(26,54,93,0)');
        this.charts.curva = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels.length ? labels : ['Sin datos'],
                datasets: [{ label: 'Ingresos ($)', data: valores.length ? valores : [0], borderColor: '#1a365d', backgroundColor: grad, borderWidth: 3, pointBackgroundColor: '#c5a059', pointRadius: 5, fill: true, tension: 0.3 }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` $ ${parseFloat(c.raw).toFixed(2)}` } } },
                onClick: (e, elements) => {
                    if (!elements.length) return;
                    const fecha = this.charts.curva.data.labels[elements[0].index];
                    this.drillDown('dia', fecha, `Check-ins del ${fecha}`);
                }
            }
        });
    },

    _dibujarDonaAreas(pa) {
        const ctx = document.getElementById('chartProduccionAreas').getContext('2d');
        if (this.charts.areas) this.charts.areas.destroy();
        this.charts.areas = new Chart(ctx, {
            type: 'doughnut',
            data: { labels: ['Hospedaje','POS / Consumos','Parqueadero'], datasets: [{ data: [parseFloat(pa.Hospedaje), parseFloat(pa.TiendaRestaurante), parseFloat(pa.Parqueadero)], backgroundColor: ['#1a365d','#27ae60','#f39c12'], borderWidth: 0 }] },
            options: { responsive: true, maintainAspectRatio: false, cutout: '72%', plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: c => ` $ ${parseFloat(c.raw).toFixed(2)}` } } } }
        });
    },

    _dibujarBarrasTop(top) {
        const ctx = document.getElementById('chartTopProductos').getContext('2d');
        if (this.charts.top) this.charts.top.destroy();
        this.charts.top = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: top.length ? top.map(x => x.Nombre.substring(0,16)) : ['Sin ventas'],
                datasets: [{ data: top.length ? top.map(x => parseFloat(x.TotalGenerado)) : [0], backgroundColor: '#c5a059', borderRadius: 5 }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` $ ${parseFloat(c.raw).toFixed(2)}` } } } }
        });
    },

    _dibujarPastelModalidad(modalidades) {
        const ctx = document.getElementById('chartTiposAlquiler').getContext('2d');
        if (this.charts.modalidad) this.charts.modalidad.destroy();
        this.charts.modalidad = new Chart(ctx, {
            type: 'pie',
            data: {
                labels: modalidades.length ? modalidades.map(x => x.TipoAlquiler.toUpperCase()) : ['Sin datos'],
                datasets: [{ data: modalidades.length ? modalidades.map(x => parseFloat(x.Ingreso)) : [0], backgroundColor: ['#e74c3c','#8e44ad','#34495e','#16a085'] }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { position: 'right' }, tooltip: { callbacks: { label: c => ` $ ${parseFloat(c.raw).toFixed(2)}` } } },
                onClick: (e, elements) => {
                    if (!elements.length) return;
                    const val = this.charts.modalidad.data.labels[elements[0].index];
                    this.drillDown('modalidad', val, `Modalidad: ${val}`);
                }
            }
        });
    },

    // ── NUEVAS GRÁFICAS DRILL-DOWN ──────────────────────────────────────

    _dibujarTipoHab(datos) {
        const ctx = document.getElementById('chartTipoHab').getContext('2d');
        if (this.charts.tipoHab) this.charts.tipoHab.destroy();
        const labels  = datos.map(x => x.TipoHab.substring(0, 18));
        const valores = datos.map(x => parseFloat(x.Ingreso));
        const colores = ['#1a365d','#2a4a7f','#3a5a8f','#4a6a9f','#5a7aaf','#6a8abf','#7a9acf','#8aaad f'];
        this.charts.tipoHab = new Chart(ctx, {
            type: 'bar',
            data: { labels: labels.length ? labels : ['Sin datos'], datasets: [{ data: valores.length ? valores : [0], backgroundColor: colores.slice(0, labels.length), borderRadius: 6 }] },
            options: {
                indexAxis: 'y',
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` $ ${parseFloat(c.raw).toFixed(2)}` } } },
                scales: { x: { ticks: { font: { size: 10 } } }, y: { ticks: { font: { size: 10 } } } },
                onClick: (e, elements) => {
                    if (!elements.length) return;
                    const val = datos[elements[0].index]?.TipoHab;
                    if (val) this.drillDown('habitacion', val, `Tipo: ${val}`);
                }
            }
        });
    },

    _dibujarProcedencia(datos) {
        const ctx = document.getElementById('chartProcedencia').getContext('2d');
        if (this.charts.procedencia) this.charts.procedencia.destroy();
        const labels  = datos.map(x => x.Procedencia);
        const valores = datos.map(x => x.Visitas);
        const paleta  = ['#27ae60','#2ecc71','#16a085','#1abc9c','#229954','#28b463','#1e8449','#17a589'];
        this.charts.procedencia = new Chart(ctx, {
            type: 'bar',
            data: { labels: labels.length ? labels : ['Sin datos'], datasets: [{ data: valores.length ? valores : [0], backgroundColor: paleta.slice(0, labels.length), borderRadius: 6 }] },
            options: {
                indexAxis: 'y',
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${c.raw} visita${c.raw !== 1 ? 's' : ''}` } } },
                scales: { x: { ticks: { font: { size: 10 }, stepSize: 1 } }, y: { ticks: { font: { size: 10 } } } },
                onClick: (e, elements) => {
                    if (!elements.length) return;
                    const val = datos[elements[0].index]?.Procedencia;
                    if (val) this.drillDown('procedencia', val, `Procedencia: ${val}`);
                }
            }
        });
    },

    _dibujarDiaSemana(datos) {
        const ctx = document.getElementById('chartDiaSemana').getContext('2d');
        if (this.charts.diaSemana) this.charts.diaSemana.destroy();
        const orden  = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
        const nombres = { Sunday:'Dom', Monday:'Lun', Tuesday:'Mar', Wednesday:'Mié', Thursday:'Jue', Friday:'Vie', Saturday:'Sáb' };
        const mapa   = {};
        datos.forEach(x => mapa[x.DiaSemana] = { ingreso: parseFloat(x.Ingreso), checkins: x.CheckIns });
        const labels  = orden.map(d => nombres[d]);
        const valores = orden.map(d => mapa[d]?.ingreso || 0);
        const maxVal  = Math.max(...valores);
        const colores = valores.map(v => v === maxVal && maxVal > 0 ? '#c5a059' : '#718096');
        this.charts.diaSemana = new Chart(ctx, {
            type: 'bar',
            data: { labels, datasets: [{ data: valores, backgroundColor: colores, borderRadius: 6 }] },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` $ ${parseFloat(c.raw).toFixed(2)}` } } },
                scales: { y: { ticks: { font: { size: 10 } } } },
                onClick: (e, elements) => {
                    if (!elements.length) return;
                    const idx    = elements[0].index;
                    const ingles = orden[idx];
                    this.drillDown('diasemana', ingles, `${labels[idx]} — detalle de check-ins`);
                }
            }
        });
    },

    // ── DRILL-DOWN ──────────────────────────────────────────────────────

    async drillDown(tipo, valor, titulo) {
        document.getElementById('drill-titulo').textContent    = titulo || valor;
        document.getElementById('drill-subtitulo').textContent = `${this._fi} al ${this._ff}`;
        document.getElementById('drill-contenido').innerHTML   =
            '<div class="drill-empty"><i class="fas fa-spinner fa-spin"></i> Cargando registros...</div>';
        document.getElementById('drill-overlay').style.display = 'flex';

        try {
            const res = await api.post('/kpi/detalle', {
                tipo, valor,
                sedeId: this._sedeId,
                fechaInicio: this._fi,
                fechaFin:    this._ff
            });
            this._renderDrillTable(tipo, res.data.registros, res.data.valor);
        } catch {
            document.getElementById('drill-contenido').innerHTML =
                '<div class="drill-empty" style="color:#e74c3c;"><i class="fas fa-exclamation-triangle"></i> Error al cargar.</div>';
        }
    },

    _renderDrillTable(tipo, registros, valor) {
        if (!registros.length) {
            document.getElementById('drill-contenido').innerHTML =
                '<div class="drill-empty">No hay registros para este elemento.</div>';
            return;
        }

        document.getElementById('drill-subtitulo').textContent =
            `${registros.length} registro${registros.length !== 1 ? 's' : ''} · ${this._fi} al ${this._ff}`;

        const fmtFecha = v => v ? new Date(v).toLocaleString('es-EC', { dateStyle:'short', timeStyle:'short' }) : '--';
        const fmtMoney = v => `$${parseFloat(v||0).toFixed(2)}`;
        const badgePago = v => {
            const color = v === 'PAGADO' ? '#27ae60' : '#e74c3c';
            return `<span style="color:${color}; font-weight:800; font-size:0.75rem;">${v||'--'}</span>`;
        };

        let html = '';

        if (tipo === 'dia') {
            html = `<table class="drill-table">
                <thead><tr>
                    <th>#</th><th>Cliente</th><th>Doc.</th><th>Procedencia</th>
                    <th>Habitación</th><th>Tipo</th><th>Modalidad</th>
                    <th>Entrada</th><th>Salida</th><th>Total</th><th>Pago</th>
                </tr></thead><tbody>
                ${registros.map((r,i) => `<tr>
                    <td>${i+1}</td>
                    <td style="font-weight:700; color:#1a365d;">${r.Cliente||'--'}</td>
                    <td>${r.Documento||'--'}</td>
                    <td>${r.Procedencia||'--'}</td>
                    <td style="font-weight:800;">${r.NroHabitacion}</td>
                    <td>${r.TipoHabitacion}</td>
                    <td>${r.TipoAlquiler||'--'}</td>
                    <td style="white-space:nowrap;">${fmtFecha(r.FechaEntrada)}</td>
                    <td style="white-space:nowrap;">${fmtFecha(r.FechaSalida)}</td>
                    <td style="font-weight:900;">${fmtMoney(r.TotalHospedaje)}</td>
                    <td>${badgePago(r.EstadoPago)}</td>
                </tr>`).join('')}
                </tbody></table>`;

        } else if (tipo === 'habitacion') {
            html = `<table class="drill-table">
                <thead><tr>
                    <th>#</th><th>Cliente</th><th>Doc.</th><th>Procedencia</th>
                    <th>Hab.</th><th>Modalidad</th><th>Entrada</th><th>Salida</th>
                    <th>Horas</th><th>Total</th><th>Pago</th>
                </tr></thead><tbody>
                ${registros.map((r,i) => `<tr>
                    <td>${i+1}</td>
                    <td style="font-weight:700; color:#1a365d;">${r.Cliente||'--'}</td>
                    <td>${r.Documento||'--'}</td>
                    <td>${r.Procedencia||'--'}</td>
                    <td style="font-weight:800;">${r.NroHabitacion}</td>
                    <td>${r.TipoAlquiler||'--'}</td>
                    <td style="white-space:nowrap;">${fmtFecha(r.FechaEntrada)}</td>
                    <td style="white-space:nowrap;">${fmtFecha(r.FechaSalida)}</td>
                    <td>${r.HorasEstadia != null ? r.HorasEstadia + 'h' : '--'}</td>
                    <td style="font-weight:900;">${fmtMoney(r.TotalHospedaje)}</td>
                    <td>${badgePago(r.EstadoPago)}</td>
                </tr>`).join('')}
                </tbody></table>`;

        } else if (tipo === 'procedencia') {
            html = `<table class="drill-table">
                <thead><tr>
                    <th>#</th><th>Cliente</th><th>Documento</th>
                    <th>Teléfono</th><th>Correo</th>
                    <th>Visitas</th><th>Total gastado</th><th>Última visita</th>
                </tr></thead><tbody>
                ${registros.map((r,i) => `<tr>
                    <td>${i+1}</td>
                    <td style="font-weight:700; color:#1a365d;">${r.Cliente||'--'}</td>
                    <td>${r.Documento||'--'}</td>
                    <td>${r.Telefono||'--'}</td>
                    <td style="color:#3498db;">${r.Correo||'--'}</td>
                    <td style="font-weight:900; color:#1a365d;">${r.Visitas}</td>
                    <td style="font-weight:900;">${fmtMoney(r.TotalGastado)}</td>
                    <td style="white-space:nowrap;">${fmtFecha(r.UltimaVisita)}</td>
                </tr>`).join('')}
                </tbody></table>`;

        } else if (tipo === 'modalidad' || tipo === 'diasemana') {
            html = `<table class="drill-table">
                <thead><tr>
                    <th>#</th><th>Cliente</th><th>Documento</th>
                    <th>Habitación</th><th>Tipo</th>
                    <th>Entrada</th><th>Salida</th>
                    <th>Horas</th><th>Total</th><th>Pago</th>
                </tr></thead><tbody>
                ${registros.map((r,i) => `<tr>
                    <td>${i+1}</td>
                    <td style="font-weight:700; color:#1a365d;">${r.Cliente||'--'}</td>
                    <td>${r.Documento||'--'}</td>
                    <td style="font-weight:800;">${r.NroHabitacion}</td>
                    <td>${r.TipoHabitacion}</td>
                    <td style="white-space:nowrap;">${fmtFecha(r.FechaEntrada)}</td>
                    <td style="white-space:nowrap;">${fmtFecha(r.FechaSalida)}</td>
                    <td>${r.HorasEstadia != null ? r.HorasEstadia + 'h' : '--'}</td>
                    <td style="font-weight:900;">${fmtMoney(r.TotalHospedaje)}</td>
                    <td>${badgePago(r.EstadoPago)}</td>
                </tr>`).join('')}
                </tbody></table>`;
        }

        document.getElementById('drill-contenido').innerHTML = html;
    },

    cerrarDrill(e) {
        if (!e || e.target === document.getElementById('drill-overlay')) {
            document.getElementById('drill-overlay').style.display = 'none';
        }
    },

    async exportarPDF() {
        if (!this._fi || !this._ff) {
            return Swal.fire({ icon: 'warning', title: 'Selecciona fechas', text: 'Aplica primero el filtro de fechas.', confirmButtonColor: '#1a365d' });
        }
        const btn = document.querySelector('[onclick="KpiModule.exportarPDF()"]');
        const orig = btn ? btn.innerHTML : '';
        if (btn) { btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generando...'; btn.disabled = true; }
        try {
            const res = await api.post('/kpi/exportar-pdf',
                { sedeId: this._sedeId, fechaInicio: this._fi, fechaFin: this._ff },
                { responseType: 'arraybuffer' }
            );
            const blob = new Blob([res.data], { type: 'application/pdf' });
            const url  = URL.createObjectURL(blob);
            const a    = document.createElement('a');
            a.href     = url;
            a.download = `KPI_${this._fi}_${this._ff}.pdf`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (err) {
            Swal.fire({ icon: 'error', title: 'Error al generar PDF', text: err.message, confirmButtonColor: '#1a365d' });
        } finally {
            if (btn) { btn.innerHTML = orig; btn.disabled = false; }
        }
    },

    exportarCSV() {
        if (!this._fi || !this._ff) {
            return Swal.fire({ icon: 'warning', title: 'Selecciona fechas', text: 'Aplica primero el filtro de fechas.', confirmButtonColor: '#1a365d' });
        }
        const d = this._lastData;
        if (!d) return;

        const BOM = '﻿';
        const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const row = cols => cols.map(esc).join(',') + '\r\n';
        let csv = BOM;

        // Nombres de campo tal como los retorna obtenerMetricas en el backend
        const m  = d.metricasHoteleras   || {};
        const p  = d.produccionAreas     || {};
        const ma = d.metricasAdicionales || {};
        const totalCheckIns = d.tiposAlquiler?.reduce((s, r) => s + (r.Cantidad || 0), 0) ?? '';
        csv += `INDICADORES KPI,${this._fi} al ${this._ff}\r\n\r\n`;
        csv += 'MÉTRICA,VALOR\r\n';
        csv += row(['Ocupación %',          m.OcupacionPorcentaje ?? '']);
        csv += row(['ADR',                  m.ADR                 ?? '']);
        csv += row(['RevPAR',               m.RevPAR              ?? '']);
        csv += row(['Ingresos Hospedaje',   p.Hospedaje           ?? '']);
        csv += row(['POS / Restaurante',    p.TiendaRestaurante   ?? '']);
        csv += row(['Parqueadero',          p.Parqueadero         ?? '']);
        csv += row(['Total Global',         p.TotalGlobal         ?? '']);
        csv += row(['Check-ins Período',    totalCheckIns]);
        csv += row(['Clientes Únicos',      ma.ClientesUnicos     ?? '']);
        csv += row(['Estadía Promedio (h)', ma.EstadiaPromHoras   ?? '']);
        csv += row(['Cartera Pendiente',    ma.CarteraPendiente   ?? '']);
        csv += '\r\n';

        if (d.topProductos?.length) {
            csv += 'TOP PRODUCTOS\r\n' + row(['Producto', 'Unidades', 'Total']);
            d.topProductos.forEach(r => { csv += row([r.Nombre, r.CantidadVendida, r.TotalGenerado]); });
            csv += '\r\n';
        }
        if (d.porTipoHabitacion?.length) {
            csv += 'POR TIPO HABITACIÓN\r\n' + row(['Tipo', 'Check-ins', 'Ingreso', 'Horas Prom.']);
            d.porTipoHabitacion.forEach(r => { csv += row([r.TipoHab, r.CheckIns, r.Ingreso, r.PromedioHoras ?? '']); });
            csv += '\r\n';
        }
        if (d.procedencia?.length) {
            csv += 'PROCEDENCIA HUÉSPEDES\r\n' + row(['Procedencia', 'Visitas', 'Ingreso']);
            d.procedencia.forEach(r => { csv += row([r.Procedencia, r.Visitas, r.Ingreso]); });
            csv += '\r\n';
        }
        if (d.tiposAlquiler?.length) {
            csv += 'MODALIDAD DE ALQUILER\r\n' + row(['Modalidad', 'Check-ins', 'Ingreso']);
            d.tiposAlquiler.forEach(r => { csv += row([r.TipoAlquiler, r.Cantidad, r.Ingreso]); });
            csv += '\r\n';
        }
        if (d.porDiaSemana?.length) {
            csv += 'POR DÍA DE LA SEMANA\r\n' + row(['Día', 'Check-ins', 'Ingreso']);
            d.porDiaSemana.forEach(r => { csv += row([r.DiaSemana, r.CheckIns, r.Ingreso]); });
        }

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = `KPI_${this._fi}_${this._ff}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }
};

module.exports = KpiModule;
