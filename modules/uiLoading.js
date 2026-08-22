// ============================================================
//  uiLoading.js — Indicador de "buscando..." para campos que
//  consultan la base local + padrón nacional (BASE_MAESTRA_NACIONAL.csv)
//  CasRodsoft Development
//
//  La búsqueda por cédula/RUC puede tardar (el padrón se recorre
//  línea por línea) y antes no había ninguna señal visual — el
//  usuario no sabía si el sistema estaba buscando o simplemente no
//  reaccionó a su Enter. Reutilizado en Recepción, Facturación
//  Manual y Retenciones/Compras/Liquidación de Compra (proveedor).
// ============================================================

function marcarBuscando(inputEl, buscando) {
    if (!inputEl) return;
    inputEl.disabled = buscando;
    inputEl.style.opacity = buscando ? '0.6' : '1';
    inputEl.style.cursor = buscando ? 'wait' : '';

    let indicador = inputEl.parentElement.querySelector('.buscando-indicador');
    if (buscando) {
        if (!indicador) {
            indicador = document.createElement('span');
            indicador.className = 'buscando-indicador';
            indicador.style.cssText = 'display:flex; align-items:center; gap:6px; font-size:0.65rem; font-weight:800; color:#2980b9; margin:-10px 0 12px 5px;';
            indicador.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Buscando en base local y padrón nacional...';
            inputEl.insertAdjacentElement('afterend', indicador);
        }
    } else if (indicador) {
        indicador.remove();
    }
}

module.exports = { marcarBuscando };
