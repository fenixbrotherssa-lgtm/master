// ============================================================
//  comprobanteEgresoPrint.js — Comprobante de Egreso (generar / adjuntar)
//  CasRodsoft Development
//
//  Para un egreso sin factura real (ej. dinero entregado a un
//  empleado que factura a su propio nombre, o a personal sin RUC):
//  genera un PDF server-side que queda GUARDADO y vinculado al
//  MovimientoID (CajaMovimientos.ImagenVoucherPath), no un simple
//  print efímero — así el contador lo encuentra después para la
//  liquidación. Si sí existe una factura real, se puede adjuntar
//  directamente en vez de generar el PDF interno.
//  Usado tanto desde Caja (recepcionista) como desde Finanzas (admin).
// ============================================================

const api = require('./api');

async function generarYAbrirComprobante(movimientoId, sedeNombre) {
    try {
        const res = await api.post(`/caja/movimiento/${movimientoId}/comprobante`, { sedeNombre });
        const base = api.defaults.baseURL.replace(/\/api\/?$/, '');
        window.open(`${base}${res.data.pdfUrl}`, '_blank');
        if (window.Toast) {
            window.Toast.fire({ icon: 'success', title: res.data.yaExistia ? 'Ya tenía un comprobante — abriendo' : 'Comprobante generado y guardado' });
        }
    } catch (err) {
        if (window.Swal) Swal.fire('Error', err.response?.data?.error || 'No se pudo generar el comprobante.', 'error');
    }
}

async function adjuntarComprobante(movimientoId, onDone) {
    if (!window.Swal) return;
    const { value: file } = await Swal.fire({
        title: 'Adjuntar comprobante',
        html: '<p style="font-size:0.8rem; color:#718096;">Sube la factura real (aunque esté a nombre del empleado) o cualquier respaldo del gasto.</p>',
        input: 'file',
        inputAttributes: { accept: 'image/*,application/pdf' },
        showCancelButton: true,
        confirmButtonText: 'Subir'
    });
    if (!file) return;

    const formData = new FormData();
    formData.append('archivo', file);

    try {
        await api.post(`/caja/movimiento/${movimientoId}/adjuntar`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
        window.Toast?.fire({ icon: 'success', title: 'Comprobante adjuntado' });
        if (onDone) onDone();
    } catch (err) {
        Swal.fire('Error', err.response?.data?.error || 'No se pudo adjuntar el archivo.', 'error');
    }
}

module.exports = { generarYAbrirComprobante, adjuntarComprobante };
