const api = require('./api');

const ReservasModule = {
    _sedeId: null,
    _tipos: [],

    async init() {
        window.ReservasModule = this;
        this._sedeId = localStorage.getItem('currentSedeId') || App.user?.SedeID || 1;

        const hoy  = new Date().toISOString().split('T')[0];
        const mas30 = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];
        const desdeEl = document.getElementById('rv-desde');
        const hastaEl = document.getElementById('rv-hasta');
        if (desdeEl) desdeEl.value = hoy;
        if (hastaEl) hastaEl.value = mas30;

        await Promise.all([this.cargarReservas(), this._cargarTipos()]);
    },

    async cargarReservas() {
        const tabla = document.getElementById('rv-tabla');
        if (!tabla) return;

        const desde  = document.getElementById('rv-desde')?.value  || '';
        const hasta  = document.getElementById('rv-hasta')?.value   || '';
        const estado = document.getElementById('rv-estado')?.value  || '';

        tabla.innerHTML = `<div style="text-align:center;padding:40px;color:#718096;font-size:.85rem;"><i class="fas fa-spinner fa-spin"></i> Cargando...</div>`;

        try {
            let url = `/reservas/lista/${this._sedeId}?`;
            if (desde)  url += `desde=${desde}&`;
            if (hasta)  url += `hasta=${hasta}&`;
            if (estado) url += `estado=${estado}&`;

            const res = await api.get(url);
            const reservas = res.data.reservas || [];
            this._renderTabla(reservas);
            this._actualizarStats(reservas);
        } catch (e) {
            if (document.getElementById('rv-tabla'))
                document.getElementById('rv-tabla').innerHTML = `<p style="color:#e74c3c;padding:20px">Error cargando reservas.</p>`;
        }
    },

    _actualizarStats(reservas) {
        const hoy = new Date().toISOString().split('T')[0];
        const pendientes  = reservas.filter(r => r.Estado === 'PENDIENTE').length;
        const confirmadas = reservas.filter(r => r.Estado === 'CONFIRMADA').length;
        const hoyCount    = reservas.filter(r => (r.FechaLlegada || '').split('T')[0] === hoy).length;

        const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        set('rv-cnt-pendiente', pendientes);
        set('rv-cnt-confirmada', confirmadas);
        set('rv-cnt-hoy', hoyCount);
        set('rv-cnt-total', reservas.length);

        const badge = document.getElementById('rv-badge-pendiente');
        if (badge) {
            if (pendientes > 0) {
                badge.style.display = 'inline';
                badge.innerHTML = `<i class="fas fa-exclamation-circle"></i> ${pendientes} pendiente${pendientes > 1 ? 's' : ''}`;
            } else {
                badge.style.display = 'none';
            }
        }
    },

    _renderTabla(reservas) {
        const tabla = document.getElementById('rv-tabla');
        if (!tabla) return;

        if (!reservas.length) {
            tabla.innerHTML = `<p style="text-align:center;color:#718096;padding:30px;font-size:.85rem;">
                <i class="fas fa-calendar-times"></i> No hay reservas para el período seleccionado.</p>`;
            return;
        }

        const origenIcon = { WEB:'🌐', TELEFONO:'📞', WHATSAPP:'💬', BOOKING:'🏨', EXPEDIA:'✈️',
            AIRBNB:'🏠', DIRECTO:'🚶', CHANNEL_MANAGER:'🔗' };

        const filas = reservas.map(rv => {
            const bdgCls = { PENDIENTE:'badge-pendiente', CONFIRMADA:'badge-confirmada',
                CANCELADA:'badge-cancelada', NOSHOW:'badge-noshow' }[rv.Estado] || 'badge-noshow';
            const icon = origenIcon[rv.Origen] || '📋';
            const rowCls = rv.EsAtrasada ? 'row-atrasada' : '';
            return `
            <tr class="${rowCls}">
                <td><code style="font-size:.8rem">${rv.CodigoReserva}</code></td>
                <td>
                    <div style="font-weight:700">${rv.NombreReserva}</div>
                    <div style="font-size:.7rem;color:#718096">${rv.Telefono || ''}</div>
                </td>
                <td style="font-size:.78rem">${rv.TipoNombre || '—'}</td>
                <td style="font-size:.78rem;white-space:nowrap">${rv.LlegadaFmt || (rv.FechaLlegada || '').split('T')[0] || '—'}</td>
                <td style="font-size:.78rem;white-space:nowrap">${rv.SalidaFmt  || (rv.FechaSalida  || '').split('T')[0] || '—'}</td>
                <td><span class="badge ${bdgCls}">${rv.Estado}</span></td>
                <td><span class="origen-badge">${icon} ${rv.Origen || '—'}</span></td>
                <td style="font-weight:800;color:#27ae60">$${parseFloat(rv.TotalEstimado || 0).toFixed(2)}</td>
                <td>${this._renderAcciones(rv)}</td>
            </tr>`;
        }).join('');

        tabla.innerHTML = `
        <table class="rv-table">
            <thead><tr>
                <th>Código</th><th>Huésped</th><th>Tipo</th>
                <th>Llegada</th><th>Salida</th><th>Estado</th>
                <th>Origen</th><th>Total</th><th>Acciones</th>
            </tr></thead>
            <tbody>${filas}</tbody>
        </table>`;
    },

    _renderAcciones(rv) {
        const btns = [];
        if (rv.Estado === 'PENDIENTE')
            btns.push(`<button class="btn-neo btn-sm" style="background:#27ae60;color:white"
                onclick="ReservasModule.confirmar(${rv.ReservaID},'${rv.CodigoReserva}')" title="Confirmar">
                <i class="fas fa-check"></i></button>`);
        if (['PENDIENTE','CONFIRMADA'].includes(rv.Estado))
            btns.push(`<button class="btn-neo btn-sm btn-danger"
                onclick="ReservasModule.cancelar(${rv.ReservaID},'${rv.CodigoReserva}')" title="Cancelar">
                <i class="fas fa-times"></i></button>`);
        if (rv.Estado === 'CONFIRMADA')
            btns.push(`<button class="btn-neo btn-sm" style="background:#718096;color:white"
                onclick="ReservasModule.noshow(${rv.ReservaID},'${rv.CodigoReserva}')" title="No-Show">
                <i class="fas fa-user-slash"></i></button>`);
        return `<div style="display:flex;gap:6px">${btns.join('')}</div>`;
    },

    async confirmar(id, codigo) {
        const conf = await Swal.fire({
            icon:'question', title:`Confirmar ${codigo}`,
            text:'Se enviará correo de confirmación al huésped.',
            showCancelButton:true, confirmButtonText:'Confirmar',
            confirmButtonColor:'#27ae60', cancelButtonText:'Cancelar'
        });
        if (!conf.isConfirmed) return;
        try {
            await api.post('/reservas/confirmar', { reservaId: id, usuarioId: App.user?.id });
            Swal.fire({ icon:'success', title:'Reserva confirmada', timer:2000, showConfirmButton:false });
            this.cargarReservas();
        } catch (e) {
            Swal.fire({ icon:'error', title:'Error', text: e.response?.data?.message || e.message, confirmButtonColor:'#1a365d' });
        }
    },

    async cancelar(id, codigo) {
        const { value: motivo } = await Swal.fire({
            title:`Cancelar ${codigo}`, input:'text',
            inputLabel:'Motivo de cancelación (opcional)',
            inputPlaceholder:'Ej: Solicitado por el huésped',
            showCancelButton:true, confirmButtonText:'Cancelar reserva',
            confirmButtonColor:'#e74c3c', cancelButtonText:'Volver'
        });
        if (motivo === undefined) return;
        try {
            await api.post('/reservas/cancelar', { reservaId: id, usuarioId: App.user?.id, motivo: motivo || 'Cancelada por recepción' });
            Swal.fire({ icon:'info', title:'Reserva cancelada', timer:2000, showConfirmButton:false });
            this.cargarReservas();
        } catch (e) {
            Swal.fire({ icon:'error', title:'Error', text: e.response?.data?.message || e.message, confirmButtonColor:'#1a365d' });
        }
    },

    async noshow(id, codigo) {
        const conf = await Swal.fire({
            icon:'warning', title:`¿El huésped no se presentó?`,
            text:`Marcar ${codigo} como No-Show libera la disponibilidad.`,
            showCancelButton:true, confirmButtonText:'Marcar No-Show',
            confirmButtonColor:'#718096', cancelButtonText:'Cancelar'
        });
        if (!conf.isConfirmed) return;
        try {
            await api.post('/reservas/noshow', { reservaId: id, usuarioId: App.user?.id });
            Swal.fire({ icon:'info', title:'Marcada como No-Show', timer:2000, showConfirmButton:false });
            this.cargarReservas();
        } catch (e) {
            Swal.fire({ icon:'error', title:'Error', text: e.response?.data?.message || e.message, confirmButtonColor:'#1a365d' });
        }
    },

    async _cargarTipos() {
        try {
            const hoy = new Date().toISOString().split('T')[0];
            const man = new Date(Date.now() + 86400000).toISOString().split('T')[0];
            const res = await api.get(`/reservas/disponibilidad/${this._sedeId}?desde=${hoy}&hasta=${man}`);
            this._tipos = res.data.tipos || [];
        } catch (_) { this._tipos = []; }
    },

    abrirModal() {
        const sel = document.getElementById('rv-form-tipo');
        if (sel) {
            sel.innerHTML = this._tipos.length
                ? this._tipos.map(t => `<option value="${t.TipoID}">${t.Descripcion} — $${t.PrecioBase}</option>`).join('')
                : '<option value="">Sin tipos disponibles</option>';
        }
        const hoy  = new Date().toISOString().split('T')[0];
        const man  = new Date(Date.now() + 86400000).toISOString().split('T')[0];
        const ll = document.getElementById('rv-form-llegada');
        const sal = document.getElementById('rv-form-salida');
        if (ll)  ll.value  = hoy;
        if (sal) sal.value = man;
        document.getElementById('rv-overlay')?.classList.add('visible');
    },

    cerrarModal() {
        document.getElementById('rv-overlay')?.classList.remove('visible');
        ['rv-form-nombre','rv-form-tel','rv-form-correo','rv-form-notas','rv-form-anticipo'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        const disp = document.getElementById('rv-form-disponibilidad');
        if (disp) disp.style.display = 'none';
    },

    async guardarReserva() {
        const nombre   = document.getElementById('rv-form-nombre')?.value.trim()  || '';
        const tel      = document.getElementById('rv-form-tel')?.value.trim()     || '';
        const correo   = document.getElementById('rv-form-correo')?.value.trim()  || '';
        const tipoId   = document.getElementById('rv-form-tipo')?.value           || '';
        const llegada  = document.getElementById('rv-form-llegada')?.value        || '';
        const salida   = document.getElementById('rv-form-salida')?.value         || '';
        const origen   = document.getElementById('rv-form-origen')?.value         || 'TELEFONO';
        const anticipo = parseFloat(document.getElementById('rv-form-anticipo')?.value || 0);
        const notas    = document.getElementById('rv-form-notas')?.value.trim()   || '';

        if (nombre.length < 2) return Swal.fire({ icon:'warning', title:'Ingresa el nombre del huésped', confirmButtonColor:'#1a365d' });
        if (tel.length < 7)    return Swal.fire({ icon:'warning', title:'Ingresa un teléfono válido', confirmButtonColor:'#1a365d' });
        if (!tipoId)           return Swal.fire({ icon:'warning', title:'Selecciona el tipo de habitación', confirmButtonColor:'#1a365d' });
        if (!llegada || !salida) return Swal.fire({ icon:'warning', title:'Selecciona las fechas', confirmButtonColor:'#1a365d' });
        if (llegada >= salida) return Swal.fire({ icon:'warning', title:'La salida debe ser posterior a la llegada', confirmButtonColor:'#1a365d' });

        try {
            const res = await api.post('/reservas/interna', {
                sedeId: this._sedeId, tipoId: parseInt(tipoId),
                nombre, telefono: tel, correo: correo || undefined,
                fechaLlegada: llegada, fechaSalida: salida, origen,
                anticipoPagado: anticipo, notas: notas || undefined,
                usuarioId: App.user?.id
            });
            this.cerrarModal();
            Swal.fire({ icon:'success', title:`Reserva ${res.data.codigoReserva} registrada`, timer:2500, showConfirmButton:false });
            this.cargarReservas();
        } catch (e) {
            const disp = document.getElementById('rv-form-disponibilidad');
            const msg = e.response?.data?.message || e.message;
            if (disp) {
                disp.style.display = 'block';
                disp.style.background = '#f8d7da';
                disp.style.color = '#721c24';
                disp.textContent = msg;
            } else {
                Swal.fire({ icon:'error', title:'Error', text: msg, confirmButtonColor:'#1a365d' });
            }
        }
    },

    destroy() {}
};

module.exports = ReservasModule;
