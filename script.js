const urunler = {
  "8691234567890": "Tuzlu Fıstık 500g",
  "8699876543210": "Kavrulmuş Badem 1kg",
  "8691112223334": "Çiğ Kaju 250g",
  "8695556667778": "Kudüs Hurma 1kg"
};

let scanner = null;

async function startScanner() {
  if (scanner) {
    await stopScanner();
  }
  scanner = new Html5Qrcode("reader");

  try {
    // Önce arka kamerayı dene
    await scanner.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: 250 },
      barkod => barkodIsle(barkod),
      err => {}
    );
  } catch (e) {
    console.warn("Arka kamera açılmadı, ön kamerayı deniyorum...", e);
    // Ön kamera fallback
    await scanner.start(
      { facingMode: "user" },
      { fps: 10, qrbox: 250 },
      barkod => barkodIsle(barkod),
      err => {}
    );
  }
}

function stopScanner() {
  if (scanner) {
    return scanner.stop().then(() => {
      scanner.clear();
      scanner = null;
    });
  }
}

function barkodIsle(barkod) {
  let urunAdi = urunler[barkod] || "Tanımsız Ürün";
  let miktar = prompt("Ürün: " + urunAdi + "\nMiktar gir:");
  if (miktar && miktar > 0) {
    urunEkle(barkod, miktar, urunAdi);
  }
}

function urunEkle(barkod, miktar, urunAdi) {
  const table = document.querySelector("#sayimTablosu tbody");
  const row = document.createElement("tr");
  row.innerHTML = `
    <td>${barkod || document.getElementById("barkod").value}</td>
    <td>${urunAdi || urunler[document.getElementById("barkod").value] || "Tanımsız Ürün"}</td>
    <td>${miktar || document.getElementById("miktar").value}</td>
    <td><button onclick="this.closest('tr').remove()">❌</button></td>
  `;
  table.appendChild(row);

  document.getElementById("barkod").value = "";
  document.getElementById("miktar").value = "";
}

function csvIndir() {
  const rows = document.querySelectorAll("#sayimTablosu tr");
  let csv = [];
  rows.forEach((row) => {
    let cols = row.querySelectorAll("td, th");
    let rowData = [];
    cols.forEach(c => rowData.push(c.innerText));
    csv.push(rowData.join(";"));
  });

  const blob = new Blob(["\uFEFF" + csv.join("\n")], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "sayim_listesi.csv";
  a.click();
}
