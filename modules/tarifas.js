// tarifas.js — Tarifas dinámicas (Fase 5)
// Calendario de precio por tipo de habitación y noche, sugerencias del motor
// (temporada, día de semana, ocupación esperada), reglas, piso/techo, historial
// de aprobaciones y descuentos dados en recepción. El sistema sugiere; solo el
// administrador aprueba (/api/tarifas). Todo el cálculo lo hace el backend.
const api = require('./api');

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n, d = 2) => n == null ? '—' : '$' + (parseFloat(n) || 0).toLocaleString('es-EC', { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (n, signo = true) => n == null || !isFinite(n) ? '—' : `${signo && n > 0 ? '+' : ''}${Number(n).toFixed(1).replace(/\.0$/, '')}%`;
const hoyISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const masDias = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const errMsg = e => (e && e.response && e.response.data && (e.response.data.error || e.response.data.message)) || (e && e.message) || 'Error';
const TIPOS_REGLA = { TEMPORADA: 'Temporada', DIA_SEMANA: 'Día de semana', OCUPACION: 'Ocupación' };
const DIAS_CORTOS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const LIMITES = { MINIMO: 'limitada por la tarifa mínima', MAXIMO: 'limitada por la tarifa máxima', TOPE_PCT: 'limitada por el tope de ajuste' };

const TarifasModule = {
    datos: null,
    sel: new Set(),
    tipos: [],

    async init() {
        window.TarifasModule = this;
        window.backView = 'dashboard';
        const hoy = hoyISO();
        document.getElementById('tf-desde').value = hoy;
        for (const p of ['tf-h', 'tf-d']) {
            document.getElementById(`${p}-desde`).value = hoy.slice(0, 8) + '01';
            document.getElementById(`${p}-hasta`).value = hoy;
        }
        this.formRegla();
        App.renderSedeSelector('sedeSelectorTarifas', () => this.recargar());
        await this.recargar();
    },

    getSedeId() {
        const sel = document.getElementById('globalSedeSelector');
        return sel ? sel.value : (localStorage.getItem('currentSedeId') || App.user.SedeID);
    },

    tab(nombre) {
        document.querySelectorAll('#seccion-tarifas .cc-tab').forEach(b => b.classList.toggle('activa', b.dataset.tab === nombre));
        document.querySelectorAll('#seccion-tarifas .cc-tabpanel').forEach(p => p.style.display = p.dataset.panel === nombre ? '' : 'none');
        if (nombre === 'calendario') this.cargarCalendario();
        if (nombre === 'reglas') this.cargarReglas();
        if (nombre === 'limites') this.cargarLimites();
        if (nombre === 'historial') this.cargarHistorial();
        if (nombre === 'descuentos') this.cargarDescuentos();
    },

    async recargar() {
        try { this.tipos = (await api.get(`/tarifas/tipos/${this.getSedeId()}`)).data || []; } catch (e) { this.tipos = []; }
        document.getElementById('tf-r-tipohab').innerHTML = '<option value="">Todos los tipos</option>' +
            this.tipos.map(t => `<option value="${t.TipoID}">${esc(t.Descripcion)}</option>`).join('');
        const activa = document.querySelector('#seccion-tarifas .cc-tab.activa');
        this.tab(activa ? activa.dataset.tab : 'calendario');
    },

    // ---------------- CALENDARIO ----------------
    async cargarCalendario() {
        const desde = document.getElementById('tf-desde').value || hoyISO();
        const dias = parseInt(document.getElementById('tf-dias').value) || 30;
        const cont = document.getElementById('tf-cal');
        cont.innerHTML = '<div class="vacio"><i class="fas fa-spinner fa-spin"></i> Calculando sugerencias...</div>';
        try {
            const r = await api.get(`/tarifas/sugerencias/${this.getSedeId()}`, { params: { desde, hasta: masDias(desde, dias - 1) } });
            this.datos = r.data;
        } catch (e) { cont.innerHTML = `<div class="vacio">${esc(errMsg(e))}</div>`; return; }
        this.sel = new Set([...this.sel].filter(k => this.celda(k)));
        this.renderCalendario();
    },

    celda(clave) {
        const [t, f] = clave.split('|');
        return (this.datos?.celdas || []).find(c => c.TipoID == t && c.Fecha === f);
    },

    renderCalendario() {
        const d = this.datos, cont = document.getElementById('tf-cal');
        if (!d.tipos.length) { cont.innerHTML = '<div class="vacio">Esta sede no tiene tipos de habitación.</div>'; return; }
        const mapa = new Map(d.celdas.map(c => [`${c.TipoID}|${c.Fecha}`, c]));
        const pendientes = d.celdas.filter(c => c.Cambia);
        const ajustadas = d.celdas.filter(c => c.ActualPct);
        const ocProm = d.dias.length ? d.dias.reduce((s, x) => s + x.Esperada, 0) / d.dias.length : 0;
        document.getElementById('tf-resumen').innerHTML = `
            <div class="kpi"><div class="t">Ocupación esperada (prom.)</div><div class="v">${pct(ocProm, false)}</div></div>
            <div class="kpi"><div class="t">Noches con tarifa ajustada</div><div class="v">${ajustadas.length}</div></div>
            <div class="kpi"><div class="t">Sugerencias por aprobar</div><div class="v" style="color:${pendientes.length ? '#b9770e' : '#1e8449'}">${pendientes.length}</div></div>
            <div class="kpi"><div class="t">Reglas activas</div><div class="v">${d.reglas.length}</div></div>
            <div class="kpi"><div class="t">Marcadas</div><div class="v">${this.sel.size}</div></div>`;

        const colorOcu = p => p >= 85 ? '#fadbd8' : p >= 60 ? '#fdebd0' : p >= 35 ? '#eef0f2' : '#d6eaf8';
        let h = '<table class="cal"><thead><tr><th class="tipo">Tipo · precio base</th>';
        for (const x of d.dias) {
            const [, m, dd] = x.Fecha.split('-');
            const finde = x.DiaSemana === 'Sábado' || x.DiaSemana === 'Viernes';
            h += `<th class="dia ${finde ? 'finde' : ''}" style="cursor:pointer;" title="Marcar todo el día" onclick="TarifasModule.marcarDia('${x.Fecha}')">${x.DiaSemana.slice(0, 3)}<br>${dd}/${m}</th>`;
        }
        h += '</tr><tr><td class="tipo">Ocupación esperada</td>';
        for (const x of d.dias) {
            const tip = `Reservado/ocupado: ${pct(x.EnLibros, false)}\nHistórico (${x.SemanasHistoria} sem.): ${x.Historica == null ? 'sin datos' : pct(x.Historica, false)}`;
            h += `<td class="ocu" style="background:${colorOcu(x.Esperada)}" title="${esc(tip)}">${pct(x.Esperada, false)}</td>`;
        }
        h += '</tr></thead><tbody>';
        for (const t of d.tipos) {
            const lim = [t.TarifaMin != null ? `mín ${money(t.TarifaMin)}` : '', t.TarifaMax != null ? `máx ${money(t.TarifaMax)}` : ''].filter(Boolean).join(' · ');
            h += `<tr><td class="tipo" title="${esc(t.Descripcion)}">${esc(t.Descripcion)}<div class="muted">${money(t.PrecioBase)} · ${t.Cuartos} cuarto(s)${lim ? ' · ' + lim : ''}</div></td>`;
            for (const x of d.dias) {
                const k = `${t.TipoID}|${x.Fecha}`, c = mapa.get(k);
                if (!c) { h += '<td></td>'; continue; }
                const clase = c.ActualPct > 0 ? 'sube' : c.ActualPct < 0 ? 'baja' : '';
                let sug = '';
                if (c.Cambia) {
                    const up = c.SugeridoPrecio > c.ActualPrecio;
                    sug = `<div class="s ${up ? 'up' : 'down'}">${up ? '▲' : '▼'} ${money(c.SugeridoPrecio)}</div>`;
                }
                const tip = [
                    `${esc(t.Descripcion)} · noche del ${x.Fecha}`,
                    `Vigente: ${money(c.ActualPrecio)} (${c.ActualPct ? pct(c.ActualPct) : 'precio base'})`,
                    c.Aprobado ? `Aprobado por ${c.Aprobado.NombreUsuario || '—'} el ${c.Aprobado.Aprobado}${c.Aprobado.Motivo ? ' — ' + c.Aprobado.Motivo : ''}` : '',
                    `Sugerido: ${money(c.SugeridoPrecio)} (${c.SugeridoPct ? pct(c.SugeridoPct) : 'precio base'})`,
                    c.Motivos.length ? 'Por: ' + c.Motivos.join(', ') : 'Ninguna regla aplica',
                    c.Limite ? 'Sugerencia ' + LIMITES[c.Limite] : '',
                    `Ocupados/reservados de este tipo: ${c.OcupadosTipo} de ${t.Cuartos}`
                ].filter(Boolean).join('\n');
                h += `<td class="celda ${clase} ${this.sel.has(k) ? 'sel' : ''}" data-k="${k}" title="${esc(tip)}"
                        onclick="TarifasModule.marcar('${k}')" ondblclick="TarifasModule.precioManual('${k}')">
                        <div class="p">${money(c.ActualPrecio)}</div>${sug}</td>`;
            }
            h += '</tr>';
        }
        cont.innerHTML = h + '</tbody></table>';
    },

    marcar(k) {
        this.sel.has(k) ? this.sel.delete(k) : this.sel.add(k);
        this.renderCalendario();
    },

    marcarDia(fecha) {
        const claves = this.datos.tipos.map(t => `${t.TipoID}|${fecha}`);
        const todas = claves.every(k => this.sel.has(k));
        claves.forEach(k => todas ? this.sel.delete(k) : this.sel.add(k));
        this.renderCalendario();
    },

    async enviar(items, motivo, titulo) {
        try {
            const r = await api.post('/tarifas/aprobar', { SedeID: this.getSedeId(), items, motivo });
            window.Toast.fire({ icon: 'success', title: `${titulo}: ${r.data.cambiadas} noche(s) actualizadas` });
            this.sel.clear();
            await this.cargarCalendario();
        } catch (e) { Swal.fire('No se aprobó', errMsg(e), 'error'); }
    },

    async aprobarSugerencias(soloMarcadas) {
        if (!this.datos) return;
        let celdas = this.datos.celdas.filter(c => c.Cambia);
        if (soloMarcadas) {
            if (!this.sel.size) return window.Toast.fire({ icon: 'info', title: 'Marque primero las casillas (clic) o un día entero (clic en la fecha)' });
            celdas = celdas.filter(c => this.sel.has(`${c.TipoID}|${c.Fecha}`));
        }
        if (!celdas.length) return window.Toast.fire({ icon: 'info', title: 'No hay sugerencias distintas de lo vigente' });
        const sube = celdas.filter(c => c.SugeridoPrecio > c.ActualPrecio).length;
        const { isConfirmed } = await Swal.fire({
            icon: 'question', title: 'Aprobar sugerencias',
            html: `Se aplicará el precio sugerido en <b>${celdas.length}</b> noche(s): ${sube} suben y ${celdas.length - sube} bajan.<br><br>
                   Desde ese momento recepción, reservas, el portal web y el bot de WhatsApp cotizan con esos precios. Las reservas ya hechas conservan su precio.`,
            showCancelButton: true, confirmButtonText: 'Aprobar', cancelButtonText: 'Cancelar', confirmButtonColor: '#27ae60'
        });
        if (!isConfirmed) return;
        await this.enviar(celdas.map(c => ({
            tipoId: c.TipoID, fecha: c.Fecha, ajustePct: c.SugeridoPct, origen: 'SUGERENCIA',
            motivo: c.Motivos.length ? c.Motivos.join(', ') : 'Ninguna regla aplica: vuelve a precio base'
        })), '', 'Sugerencias aprobadas');
    },

    async precioManual(clave) {
        const claves = clave ? [clave] : [...this.sel];
        if (!claves.length) return window.Toast.fire({ icon: 'info', title: 'Marque las casillas o haga doble clic en una' });
        const celdas = claves.map(k => this.celda(k)).filter(Boolean);
        const tiposSel = [...new Set(celdas.map(c => c.TipoID))];
        const unaBase = tiposSel.length === 1 ? celdas[0].Base : null;
        const { value: v } = await Swal.fire({
            title: 'Precio manual',
            html: `<p style="font-size:.85rem;">${celdas.length} noche(s)${tiposSel.length > 1 ? ' de varios tipos: indique un % sobre el precio base de cada tipo' : ` · precio base ${money(unaBase)}`}.</p>
                   ${tiposSel.length === 1
                       ? `<input id="sw-precio" type="number" step="0.5" min="0" class="swal2-input" placeholder="Precio por noche" value="${celdas[0].ActualPrecio}">`
                       : `<input id="sw-pct" type="number" step="0.5" class="swal2-input" placeholder="Ajuste % (ej. 15 o -10)">`}
                   <input id="sw-motivo" class="swal2-input" placeholder="Motivo (obligatorio)">`,
            showCancelButton: true, confirmButtonText: 'Aprobar', cancelButtonText: 'Cancelar',
            preConfirm: () => {
                const motivo = document.getElementById('sw-motivo').value.trim();
                if (motivo.length < 5) return Swal.showValidationMessage('Escriba el motivo (mínimo 5 caracteres)');
                if (tiposSel.length === 1) {
                    const p = parseFloat(document.getElementById('sw-precio').value);
                    if (!(p > 0)) return Swal.showValidationMessage('Precio inválido');
                    return { pct: unaBase > 0 ? (p / unaBase - 1) * 100 : 0, motivo };
                }
                const x = parseFloat(document.getElementById('sw-pct').value);
                if (!isFinite(x)) return Swal.showValidationMessage('Porcentaje inválido');
                return { pct: x, motivo };
            }
        });
        if (!v) return;
        await this.enviar(celdas.map(c => ({ tipoId: c.TipoID, fecha: c.Fecha, ajustePct: Math.round(v.pct * 10000) / 10000, origen: 'MANUAL' })),
            v.motivo, 'Precio manual');
    },

    async volverBase() {
        const celdas = [...this.sel].map(k => this.celda(k)).filter(c => c && c.ActualPct);
        if (!celdas.length) return window.Toast.fire({ icon: 'info', title: 'Marque casillas que tengan un ajuste' });
        const { value: motivo } = await Swal.fire({
            title: 'Volver al precio base', text: `${celdas.length} noche(s) volverán a su precio base.`,
            input: 'text', inputPlaceholder: 'Motivo (obligatorio)', showCancelButton: true, confirmButtonText: 'Aplicar', cancelButtonText: 'Cancelar',
            inputValidator: v => (!v || v.trim().length < 5) ? 'Escriba el motivo (mínimo 5 caracteres)' : undefined
        });
        if (!motivo) return;
        await this.enviar(celdas.map(c => ({ tipoId: c.TipoID, fecha: c.Fecha, ajustePct: 0, origen: 'MANUAL' })), motivo.trim(), 'Precio base');
    },

    // ---------------- REGLAS ----------------
    formRegla() {
        const tipo = document.getElementById('tf-r-tipo').value;
        document.getElementById('tf-r-fechas').style.display = tipo === 'TEMPORADA' ? '' : 'none';
        document.getElementById('tf-r-ocup').style.display = tipo === 'OCUPACION' ? '' : 'none';
        document.getElementById('tf-r-dias').style.display = tipo === 'OCUPACION' ? 'none' : '';
        document.getElementById('tf-r-dias-lbl').textContent = tipo === 'DIA_SEMANA' ? 'Días en que aplica' : 'Solo estos días (opcional)';
    },

    limpiarRegla() {
        for (const id of ['tf-r-id', 'tf-r-nombre', 'tf-r-pct', 'tf-r-desde', 'tf-r-hasta', 'tf-r-omin', 'tf-r-omax']) document.getElementById(id).value = '';
        document.getElementById('tf-r-tipohab').value = '';
        document.querySelectorAll('#tf-r-dias input[type=checkbox]').forEach(c => c.checked = false);
        this.formRegla();
    },

    async cargarReglas() {
        const cont = document.getElementById('tf-reglas');
        try { this.reglas = (await api.get(`/tarifas/reglas/${this.getSedeId()}`)).data || []; }
        catch (e) { cont.innerHTML = `<div class="vacio">${esc(errMsg(e))}</div>`; return; }
        if (!this.reglas.length) {
            cont.innerHTML = '<div class="vacio">Sin reglas todavía. Ejemplos: "Fin de semana" (Día de semana, Vie y Sáb, +10 %), "Ocupación alta" (Ocupación 80–100 %, +15 %), "Feriado de Carnaval" (Temporada, +25 %), "Temporada baja entre semana" (Temporada, Lun–Jue, -10 %).</div>';
            return;
        }
        const dias = s => s ? [...s].map((b, i) => b === '1' ? DIAS_CORTOS[i] : '').filter(Boolean).join(' ') : '';
        const cuando = r => r.Tipo === 'TEMPORADA' ? `${r.FechaDesde} → ${r.FechaHasta}${r.DiasSemana ? ' · ' + dias(r.DiasSemana) : ''}`
            : r.Tipo === 'DIA_SEMANA' ? dias(r.DiasSemana) : `ocupación ${Number(r.OcupacionMin)}–${Number(r.OcupacionMax)} %`;
        cont.innerHTML = `<table><thead><tr><th>Regla</th><th>Tipo</th><th>Cuándo</th><th>Habitación</th><th class="num">Ajuste</th><th>Actualizada</th><th></th></tr></thead><tbody>
            ${this.reglas.map(r => `<tr class="${r.Activa ? '' : 'inactiva'}">
                <td><b>${esc(r.Nombre)}</b></td><td>${TIPOS_REGLA[r.Tipo]}</td><td>${esc(cuando(r))}</td>
                <td>${esc(r.TipoNombre || 'Todos')}</td>
                <td class="num"><span class="badge ${r.AjustePct > 0 ? 'b-medio' : 'b-ok'}">${pct(Number(r.AjustePct))}</span></td>
                <td class="muted">${esc(r.Actualizada)}</td>
                <td style="white-space:nowrap;">
                    <button class="cc-btn mini" onclick="TarifasModule.editarRegla(${r.ReglaID})"><i class="fas fa-pen"></i></button>
                    <button class="cc-btn mini ${r.Activa ? 'danger' : 'ok'}" onclick="TarifasModule.activarRegla(${r.ReglaID}, ${r.Activa ? 0 : 1})">${r.Activa ? 'Desactivar' : 'Activar'}</button>
                </td></tr>`).join('')}</tbody></table>`;
    },

    editarRegla(id) {
        const r = (this.reglas || []).find(x => x.ReglaID === id);
        if (!r) return;
        document.getElementById('tf-r-id').value = r.ReglaID;
        document.getElementById('tf-r-nombre').value = r.Nombre;
        document.getElementById('tf-r-tipo').value = r.Tipo;
        document.getElementById('tf-r-tipohab').value = r.TipoID || '';
        document.getElementById('tf-r-pct').value = Number(r.AjustePct);
        document.getElementById('tf-r-desde').value = r.FechaDesde || '';
        document.getElementById('tf-r-hasta').value = r.FechaHasta || '';
        document.getElementById('tf-r-omin').value = r.OcupacionMin ?? '';
        document.getElementById('tf-r-omax').value = r.OcupacionMax ?? '';
        document.querySelectorAll('#tf-r-dias input[type=checkbox]').forEach(c => c.checked = !!r.DiasSemana && r.DiasSemana[c.dataset.d] === '1');
        this.formRegla();
        document.getElementById('tf-r-nombre').focus();
    },

    async guardarRegla() {
        const tipo = document.getElementById('tf-r-tipo').value;
        const marcados = [...document.querySelectorAll('#tf-r-dias input[type=checkbox]')].map(c => c.checked ? '1' : '0').join('');
        const body = {
            SedeID: this.getSedeId(),
            ReglaID: document.getElementById('tf-r-id').value || null,
            Nombre: document.getElementById('tf-r-nombre').value,
            Tipo: tipo,
            TipoID: document.getElementById('tf-r-tipohab').value || null,
            AjustePct: document.getElementById('tf-r-pct').value,
            FechaDesde: document.getElementById('tf-r-desde').value,
            FechaHasta: document.getElementById('tf-r-hasta').value,
            DiasSemana: marcados.includes('1') ? marcados : null,
            OcupacionMin: document.getElementById('tf-r-omin').value,
            OcupacionMax: document.getElementById('tf-r-omax').value
        };
        try {
            await api.post('/tarifas/regla', body);
            window.Toast.fire({ icon: 'success', title: 'Regla guardada. Revise las sugerencias en el calendario.' });
            this.limpiarRegla();
            await this.cargarReglas();
        } catch (e) { Swal.fire('No se guardó', errMsg(e), 'error'); }
    },

    async activarRegla(id, activa) {
        try {
            await api.put(`/tarifas/regla/${id}/activa`, { SedeID: this.getSedeId(), Activa: activa });
            await this.cargarReglas();
        } catch (e) { Swal.fire('Error', errMsg(e), 'error'); }
    },

    // ---------------- LÍMITES Y AJUSTES ----------------
    async cargarLimites() {
        const cont = document.getElementById('tf-tipos');
        try {
            this.tipos = (await api.get(`/tarifas/tipos/${this.getSedeId()}`)).data || [];
            const c = (await api.get(`/tarifas/config/${this.getSedeId()}`)).data;
            document.getElementById('tf-c-min').value = c.TARIFA_AJUSTE_MIN_PCT;
            document.getElementById('tf-c-max').value = c.TARIFA_AJUSTE_MAX_PCT;
            document.getElementById('tf-c-red').value = c.TARIFA_REDONDEO;
            document.getElementById('tf-c-sem').value = c.TARIFA_SEMANAS_HISTORIA;
            document.getElementById('tf-c-mom').checked = String(c.TARIFA_DINAMICA_MOMENTO) === '1';
        } catch (e) { cont.innerHTML = `<div class="vacio">${esc(errMsg(e))}</div>`; return; }
        const rango = t => t.PrecioDiaMin == null ? '—' : (t.PrecioDiaMin === t.PrecioDiaMax ? money(t.PrecioDiaMin) : `${money(t.PrecioDiaMin)} – ${money(t.PrecioDiaMax)}`);
        cont.innerHTML = `<table><thead><tr><th>Tipo</th><th class="num">Cuartos</th><th class="num">Precio base (reservas)</th><th class="num">Precio día en fichas</th>
            <th>Tarifa mínima</th><th>Tarifa máxima</th><th></th></tr></thead><tbody>
            ${this.tipos.map(t => `<tr><td><b>${esc(t.Descripcion)}</b></td><td class="num">${t.Cuartos}</td><td class="num">${money(t.PrecioBase)}</td>
                <td class="num">${rango(t)}</td>
                <td><input type="number" step="0.5" min="0" id="tf-min-${t.TipoID}" value="${t.TarifaMin ?? ''}" style="width:110px;" placeholder="sin piso"></td>
                <td><input type="number" step="0.5" min="0" id="tf-max-${t.TipoID}" value="${t.TarifaMax ?? ''}" style="width:110px;" placeholder="sin techo"></td>
                <td><button class="cc-btn mini ok" onclick="TarifasModule.guardarLimites(${t.TipoID})"><i class="fas fa-save"></i></button></td></tr>`).join('')}
            </tbody></table>`;
    },

    async guardarLimites(tipoId) {
        try {
            await api.put(`/tarifas/limites/${tipoId}`, {
                SedeID: this.getSedeId(),
                TarifaMin: document.getElementById(`tf-min-${tipoId}`).value,
                TarifaMax: document.getElementById(`tf-max-${tipoId}`).value
            });
            window.Toast.fire({ icon: 'success', title: 'Límites guardados' });
        } catch (e) { Swal.fire('No se guardó', errMsg(e), 'error'); }
    },

    async guardarConfig() {
        try {
            await api.put('/tarifas/config', {
                SedeID: this.getSedeId(),
                config: {
                    TARIFA_AJUSTE_MIN_PCT: document.getElementById('tf-c-min').value,
                    TARIFA_AJUSTE_MAX_PCT: document.getElementById('tf-c-max').value,
                    TARIFA_REDONDEO: document.getElementById('tf-c-red').value,
                    TARIFA_SEMANAS_HISTORIA: document.getElementById('tf-c-sem').value,
                    TARIFA_DINAMICA_MOMENTO: document.getElementById('tf-c-mom').checked
                }
            });
            window.Toast.fire({ icon: 'success', title: 'Ajustes guardados' });
        } catch (e) { Swal.fire('No se guardó', errMsg(e), 'error'); }
    },

    // ---------------- HISTORIAL ----------------
    async cargarHistorial() {
        const cont = document.getElementById('tf-historial');
        let rows;
        try {
            rows = (await api.get(`/tarifas/historial/${this.getSedeId()}`, { params: {
                desde: document.getElementById('tf-h-desde').value, hasta: document.getElementById('tf-h-hasta').value } })).data;
        } catch (e) { cont.innerHTML = `<div class="vacio">${esc(errMsg(e))}</div>`; return; }
        if (!rows.length) { cont.innerHTML = '<div class="vacio">Sin cambios de tarifa en ese rango.</div>'; return; }
        const antes = r => r.AjusteAnterior == null ? 0 : Number(r.AjusteAnterior);
        cont.innerHTML = `<table><thead><tr><th>Cuándo</th><th>Usuario</th><th>Noche</th><th>Tipo</th><th class="num">Antes</th><th class="num">Después</th><th>Origen</th><th>Motivo</th></tr></thead><tbody>
            ${rows.map(r => `<tr><td class="muted">${esc(r.FechaHora)}</td><td>${esc(r.NombreUsuario || '—')}</td><td>${esc(r.Noche)}</td><td>${esc(r.TipoNombre)}</td>
                <td class="num">${money(Number(r.PrecioBase) * (1 + antes(r) / 100))} <span class="muted">${antes(r) ? pct(antes(r)) : 'base'}</span></td>
                <td class="num"><b>${money(r.PrecioNuevo)}</b> <span class="muted">${r.AjusteNuevo == null ? 'base' : pct(Number(r.AjusteNuevo))}</span></td>
                <td><span class="badge ${r.Origen === 'SUGERENCIA' ? 'b-ok' : 'b-medio'}">${r.Origen === 'SUGERENCIA' ? 'Sugerencia' : 'Manual'}</span></td>
                <td>${esc(r.Motivo || '')}</td></tr>`).join('')}</tbody></table>`;
    },

    // ---------------- DESCUENTOS ----------------
    async cargarDescuentos() {
        const cont = document.getElementById('tf-descuentos');
        let rows;
        try {
            rows = (await api.get(`/tarifas/descuentos/${this.getSedeId()}`, { params: {
                desde: document.getElementById('tf-d-desde').value, hasta: document.getElementById('tf-d-hasta').value } })).data;
        } catch (e) { cont.innerHTML = `<div class="vacio">${esc(errMsg(e))}</div>`; return; }
        const desc = rows.filter(r => r.Descuento > 0), rec = rows.filter(r => r.Descuento < 0);
        const suma = a => a.reduce((s, r) => s + Number(r.Descuento), 0);
        const porUsuario = {};
        desc.forEach(r => { porUsuario[r.Usuario || '—'] = (porUsuario[r.Usuario || '—'] || 0) + Number(r.Descuento); });
        const top = Object.entries(porUsuario).sort((a, b) => b[1] - a[1])[0];
        document.getElementById('tf-desc-kpis').innerHTML = `
            <div class="kpi"><div class="t">Check-ins con descuento</div><div class="v">${desc.length}</div></div>
            <div class="kpi"><div class="t">Total descontado</div><div class="v" style="color:#b03a2e">${money(suma(desc))}</div></div>
            <div class="kpi"><div class="t">Cobrado sobre la lista</div><div class="v">${money(-suma(rec))}</div></div>
            <div class="kpi"><div class="t">Usuario con más descuento</div><div class="v" style="font-size:.95rem">${top ? esc(top[0]) + ' · ' + money(top[1]) : '—'}</div></div>`;
        if (!rows.length) { cont.innerHTML = '<div class="vacio">Todos los check-ins del rango se cobraron a la tarifa de lista.</div>'; return; }
        cont.innerHTML = `<table><thead><tr><th>Folio</th><th>Entrada</th><th>Hab.</th><th>Huésped</th><th>Tipo</th><th class="num">Lista</th><th class="num">Cobrado</th><th class="num">Diferencia</th><th>Usuario</th><th>Reserva</th></tr></thead><tbody>
            ${rows.map(r => `<tr><td>#${r.RecepcionID}</td><td class="muted">${esc(r.Entrada)}</td><td>${esc(r.NroHabitacion)}</td><td>${esc(r.Huesped || '')}</td><td>${esc(r.TipoAlquiler)}</td>
                <td class="num">${money(r.TotalLista)}</td><td class="num">${money(r.TotalHospedaje)}</td>
                <td class="num" style="color:${r.Descuento > 0 ? '#b03a2e' : '#1e8449'}; font-weight:900;">${r.Descuento > 0 ? '-' : '+'}${money(Math.abs(r.Descuento))}</td>
                <td>${esc(r.Usuario || '—')}</td><td>${r.CodigoReserva ? `<span class="badge b-gris">${esc(r.CodigoReserva)}</span>` : ''}</td></tr>`).join('')}</tbody></table>`;
    },
};

module.exports = TarifasModule;
