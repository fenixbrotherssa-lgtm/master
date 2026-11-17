// anticiposReserva.js — Anticipo de una reserva como dinero REAL en caja (2.2.0).
// Lo usan Recepción (tarjeta de reserva) y Reservas (tabla). Cada anticipo queda como movimiento de caja
// "ANTICIPO | Reserva #ID |" con método y comprobante; el folio lo suma solo al hacer el check-in desde la reserva.
const api = require('./api');

const $$ = (id) => document.getElementById(id);
const dinero = (n) => '$' + (Number(n) || 0).toFixed(2);
const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const AnticiposReserva = {
    async cajaAbierta() {
        try {
            const user = JSON.parse(localStorage.getItem('user') || '{}');
            const sedeId = localStorage.getItem('currentSedeId') || user.SedeID;
            const r = await api.get(`/caja/estado/${user.UsuarioID}/${sedeId}`);
            return r.data.abierta ? r.data.caja.CajaID : null;
        } catch (_) { return null; }
    },

    /** Abre el anticipo de una reserva. `montoSugerido`: prellenado (p. ej. lo escrito al crear la reserva). */
    async abrir(reservaId, { montoSugerido = 0, alCambiar = null } = {}) {
        let info;
        try { info = (await api.get(`/reservas/anticipos/${reservaId}`)).data; }
        catch (e) { return Swal.fire({ icon: 'error', title: 'ANTICIPO', text: e.response?.data?.error || 'No se pudo leer la reserva.' }); }
        const rv = info.reserva;
        const viva = ['PENDIENTE', 'CONFIRMADA'].includes(rv.Estado) && !rv.RecepcionID;
        const total = Number(rv.TotalEstimado) || 0;
        const enCaja = Number(info.anticipoCaja) || 0;
        const puedeDevolver = viva || ['CANCELADA', 'NOSHOW'].includes(rv.Estado);
        const permisoDevolver = !window.Permisos || window.Permisos.puede('reservas', 3);

        const filas = (info.movimientos || []).map(m => `
            <tr><td>${esc(m.FechaFmt)}</td><td>${m.TipoMovimiento === 'Ingreso' ? 'Anticipo' : '<b style="color:#c53030">Devolución</b>'}</td>
                <td>${esc(m.Metodo)}${m.ReferenciaVoucher ? ' · ' + esc(m.ReferenciaVoucher) : ''}${m.ImagenVoucherPath ? ' 📎' : ''}</td>
                <td>${esc(m.Usuario)} (caja #${m.CajaID || '-'})</td>
                <td style="text-align:right;font-weight:800">${m.TipoMovimiento === 'Ingreso' ? '' : '-'}${dinero(m.Monto)}</td></tr>`).join('');
        const aviso = info.declaradoSinCaja > 0.009 ? `
            <div style="background:#fff5e6;border:1px solid #dd6b20;color:#7b341e;border-radius:10px;padding:8px 10px;margin:8px 0;font-size:.78rem;text-align:left">
              <b>⚠ ${dinero(info.declaradoSinCaja)} anotado en la reserva SIN registro en caja</b> (antes de la 2.2.0 el anticipo era solo un número).
              Si el dinero se recibió, regístrelo aquí con su comprobante para que quede en caja y se descuente en el check-in.</div>` : '';
        const estadoTxt = viva ? '' : `<div style="margin:6px 0;font-size:.78rem;color:#718096">Reserva ${esc(rv.Estado)}${rv.RecepcionID ? ` · el anticipo ya está aplicado al folio #${rv.RecepcionID}` : ''}: no recibe más anticipos.</div>`;
        const sugerido = Math.max(0, Math.min(Number(montoSugerido) || info.declaradoSinCaja || 0, total - enCaja));

        const form = viva ? `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;text-align:left;margin-top:10px">
              <div><label class="label-hint">MONTO ($)</label><input id="ar-monto" type="number" min="0" step="0.01" class="input-neo" value="${sugerido ? sugerido.toFixed(2) : ''}"></div>
              <div><label class="label-hint">MÉTODO</label><select id="ar-metodo" class="input-neo" data-metodos-pago>
                   <option value="1">EFECTIVO</option><option value="2">TRANSFERENCIA</option><option value="3">TARJETA</option></select></div>
              <div style="grid-column:1/3"><label class="label-hint">REFERENCIA (Nro. transferencia / lote)</label><input id="ar-ref" class="input-neo" maxlength="100"></div>
              <div style="grid-column:1/3"><label class="label-hint">COMPROBANTE (obligatorio si no es efectivo)</label><input id="ar-voucher" type="file" accept="image/*,application/pdf" class="input-neo"></div>
            </div>` : '';

        const r = await Swal.fire({
            title: `ANTICIPO · ${esc(rv.CodigoReserva)}`,
            width: 640,
            html: `<div style="font-size:.85rem">
                     <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;font-weight:800">
                       <span>Total reserva: ${dinero(total)}</span><span style="color:#2f855a">En caja: ${dinero(enCaja)}</span>
                       <span style="color:#1a365d">Falta: ${dinero(Math.max(0, total - enCaja))}</span></div>
                     ${aviso}${estadoTxt}
                     ${filas ? `<table style="width:100%;font-size:.74rem;margin-top:8px;border-collapse:collapse;text-align:left">${filas}</table>` : ''}
                     ${form}</div>`,
            showConfirmButton: viva,
            confirmButtonText: '<i class="fas fa-cash-register"></i> REGISTRAR EN CAJA',
            confirmButtonColor: '#2f855a',
            showDenyButton: puedeDevolver && permisoDevolver && enCaja > 0.009,
            denyButtonText: 'DEVOLVER ANTICIPO',
            showCancelButton: true, cancelButtonText: 'CERRAR',
            background: '#eef1f5',
            preConfirm: async () => {
                const monto = parseFloat($$('ar-monto').value) || 0;
                const metodoId = $$('ar-metodo').value;
                const archivo = $$('ar-voucher').files[0];
                if (!(monto > 0)) return Swal.showValidationMessage('Ingrese el monto recibido');
                if (window.MetodosPago && window.MetodosPago.esNoEfectivo(metodoId) && !archivo)
                    return Swal.showValidationMessage('Adjunte el comprobante (transferencia / tarjeta)');
                const cajaId = await this.cajaAbierta();
                if (!cajaId) return Swal.showValidationMessage('CAJA CERRADA: abra su turno de caja para recibir el dinero');
                const fd = new FormData();
                fd.append('reservaId', reservaId); fd.append('cajaId', cajaId); fd.append('monto', monto);
                fd.append('metodoId', metodoId); fd.append('referencia', $$('ar-ref').value || '');
                if (archivo) fd.append('voucher', archivo);
                try { return (await api.post('/reservas/anticipo', fd, { headers: { 'Content-Type': 'multipart/form-data' } })).data; }
                catch (e) { return Swal.showValidationMessage(e.response?.data?.error || 'No se pudo registrar'); }
            }
        });
        if (r.isConfirmed && r.value) {
            window.Toast && window.Toast.fire({ icon: 'success', title: `Anticipo registrado en caja. Total anticipado ${dinero(r.value.anticipoCaja)}` });
            if (alCambiar) alCambiar();
        } else if (r.isDenied) {
            await this.devolver(reservaId, enCaja, alCambiar);
        }
    },

    async devolver(reservaId, enCaja, alCambiar) {
        const r = await Swal.fire({
            title: 'DEVOLVER ANTICIPO',
            html: `<div style="text-align:left;font-size:.85rem">
                     <p style="color:#718096">Sale de su caja como egreso. Anticipo en caja: <b>${dinero(enCaja)}</b>.</p>
                     <label class="label-hint">MONTO ($)</label><input id="ad-monto" type="number" min="0" step="0.01" class="input-neo" value="${enCaja.toFixed(2)}">
                     <label class="label-hint">MÉTODO</label><select id="ad-metodo" class="input-neo" data-metodos-pago>
                        <option value="1">EFECTIVO</option><option value="2">TRANSFERENCIA</option></select>
                     <label class="label-hint">REFERENCIA</label><input id="ad-ref" class="input-neo" maxlength="100">
                     <label class="label-hint">MOTIVO (obligatorio)</label><input id="ad-motivo" class="input-neo" maxlength="150">
                     <label class="label-hint">COMPROBANTE (opcional)</label><input id="ad-voucher" type="file" accept="image/*,application/pdf" class="input-neo"></div>`,
            showCancelButton: true, confirmButtonText: 'DEVOLVER', confirmButtonColor: '#c53030', cancelButtonText: 'CANCELAR',
            background: '#eef1f5',
            preConfirm: async () => {
                const monto = parseFloat($$('ad-monto').value) || 0;
                const motivo = ($$('ad-motivo').value || '').trim();
                if (!(monto > 0)) return Swal.showValidationMessage('Ingrese el monto');
                if (motivo.length < 5) return Swal.showValidationMessage('Indique el motivo');
                const cajaId = await this.cajaAbierta();
                if (!cajaId) return Swal.showValidationMessage('CAJA CERRADA: abra su turno de caja');
                const fd = new FormData();
                fd.append('reservaId', reservaId); fd.append('cajaId', cajaId); fd.append('monto', monto);
                fd.append('metodoId', $$('ad-metodo').value); fd.append('referencia', $$('ad-ref').value || ''); fd.append('motivo', motivo);
                const archivo = $$('ad-voucher').files[0];
                if (archivo) fd.append('voucher', archivo);
                try { return (await api.post('/reservas/anticipo/devolver', fd, { headers: { 'Content-Type': 'multipart/form-data' } })).data; }
                catch (e) { return Swal.showValidationMessage(e.response?.data?.error || 'No se pudo devolver'); }
            }
        });
        if (r.isConfirmed && r.value) {
            window.Toast && window.Toast.fire({ icon: 'success', title: `Devolución registrada. Anticipo en caja ${dinero(r.value.anticipoCaja)}` });
            if (alCambiar) alCambiar();
        }
    },

    /** Texto corto para listas: "Anticipo $X" / "⚠ $Y sin caja". */
    etiqueta(rv) {
        const caja = Number(rv.AnticipoCaja) || 0;
        const anotado = Math.max(0, (Number(rv.AnticipoPagado) || 0) - caja);
        const partes = [];
        if (caja > 0.009) partes.push(`<span style="color:#2f855a;font-weight:800">Anticipo ${dinero(caja)}</span>`);
        if (anotado > 0.009) partes.push(`<span style="color:#c05621;font-weight:800" title="Anotado en la reserva sin registro en caja">⚠ ${dinero(anotado)} sin caja</span>`);
        return partes.join(' · ');
    }
};

window.AnticiposReserva = AnticiposReserva;
module.exports = AnticiposReserva;
