// Service Worker registration
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(registration => {
                console.log('Service Worker registered:', registration);
            })
            .catch(error => {
                console.error('Service Worker registration failed:', error);
            });
    });
}

// UI elements
const priceForm = document.getElementById('price-form');
const unitPriceInput = document.getElementById('unit-price');
const taxRateInput = document.getElementById('tax-rate');
const resultsList = document.getElementById('results-list');

// Event Listeners
unitPriceInput.addEventListener('input', () => {
    calculateFuelVolume();
});
taxRateInput.addEventListener('input', () => {
    calculateFuelVolume();
});

function calculateFuelVolume() {
    const unitPrice = parseFloat(unitPriceInput.value);
    const taxRate = parseFloat(taxRateInput.value);

    if (isNaN(unitPrice) || unitPrice <= 0) {
        resultsList.innerHTML = '<li>有効な単価を入力してください。</li>';
        return;
    }
    if (isNaN(taxRate) || taxRate < 0 || taxRate > 100) {
        resultsList.innerHTML = '<li>有効な消費税率（0〜100%）を入力してください。</li>';
        return;
    }

    resultsList.innerHTML = ''; // Clear previous results

    const amounts = [1000, 2000, 3000, 4000, 5000];
    const adjustmentValue = 0.03; // 目安として減らす量

    amounts.forEach(amount => {
        // 税込み価格から税抜き価格を計算
        const amountExcludingTax = amount / (1 + taxRate / 100);
        const volume = amountExcludingTax / unitPrice;
        
        // 目安の量を計算
        const adjustedVolume = Math.max(0, volume - adjustmentValue); // 0より小さくならないように

        const listItem = document.createElement('li');
        listItem.textContent = `${amount}円 (税率${taxRate}%): ${volume.toFixed(3)} L (操作目安: ${adjustedVolume.toFixed(3)} L)`;
        resultsList.appendChild(listItem);
    });
}

// Initial calculation if there's a value on load (e.g., from browser autofill)
document.addEventListener('DOMContentLoaded', () => {
    if (!taxRateInput.value) {
        taxRateInput.value = 10;
    }
    if (unitPriceInput.value || taxRateInput.value) {
        calculateFuelVolume();
    }
});
