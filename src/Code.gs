/**
 * SETAG — Sistema Emissor de Termos de Ativos sob Guarda
 * Back-end: Google Apps Script (Code.gs)
 */

// ID da pasta do Google Drive onde ficam os termos (copie da URL da pasta: drive.google.com/drive/folders/<ID>)
var ID_PASTA_TERMOS = "COLE_AQUI_O_ID_DA_PASTA";
var LIMITE_RESULTADOS = 15;
var FUSO = "America/Sao_Paulo";
var MIME_PDF = "application/pdf";
var MIME_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function mimePermitido_(mime) {
  return mime === MIME_PDF || mime === MIME_DOCX;
}
var FAVICON_URL = "https://raw.githubusercontent.com/dehsouzasou/setag/main/docs/icone.png";

function doGet() {
  return HtmlService.createTemplateFromFile("Index")
    .evaluate()
    .setTitle("SETAG")
    .setFaviconUrl(FAVICON_URL)
    .addMetaTag("viewport", "width=device-width, initial-scale=1.0")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Escapa o termo para uso dentro de aspas simples na query do Drive */
function escaparTermo_(t) {
  return String(t).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/** Verifica (com cache) se uma pasta é a pasta raiz ou está dentro dela */
function pastaPertenceARaiz_(pasta, cache, nivel) {
  var id = pasta.getId();
  if (id === ID_PASTA_TERMOS) return true;
  if (cache[id] !== undefined) return cache[id];
  if (nivel > 8) return false;

  var resultado = false;
  var pais = pasta.getParents();
  while (pais.hasNext()) {
    if (pastaPertenceARaiz_(pais.next(), cache, nivel + 1)) {
      resultado = true;
      break;
    }
  }
  cache[id] = resultado;
  return resultado;
}

function arquivoPertenceARaiz_(arquivo, cache) {
  var pais = arquivo.getParents();
  while (pais.hasNext()) {
    var pai = pais.next();
    if (pastaPertenceARaiz_(pai, cache, 0)) return pai.getName();
  }
  return null;
}

/**
 * Pesquisa termos (PDF e Word .docx) por nome da pasta do colaborador ou nome do arquivo
 */
function pesquisarTermosDrive(termo) {
  try {
    termo = String(termo || "").trim();
    if (termo.length < 2) {
      return { sucesso: false, erro: "Digite ao menos 2 caracteres." };
    }

    var q = escaparTermo_(termo);
    var raiz = DriveApp.getFolderById(ID_PASTA_TERMOS);
    var resultados = [];
    var vistos = {};
    var cache = {};

    function adicionar(arq, nomePasta) {
      var id = arq.getId();
      if (vistos[id] || resultados.length >= LIMITE_RESULTADOS) return;
      if (arq.getName().indexOf("~$") === 0) return; // arquivo temporário do Word
      vistos[id] = true;
      resultados.push({
        id: id,
        nome: arq.getName(),
        pasta: nomePasta || "",
        data: Utilities.formatDate(arq.getLastUpdated(), FUSO, "dd/MM/yyyy HH:mm")
      });
    }

    // 1) Subpastas cujo nome contém o termo
    var subpastas = raiz.searchFolders("title contains '" + q + "' and trashed = false");
    while (subpastas.hasNext() && resultados.length < LIMITE_RESULTADOS) {
      var sub = subpastas.next();
      var arquivos = sub.getFiles();
      while (arquivos.hasNext() && resultados.length < LIMITE_RESULTADOS) {
        var a = arquivos.next();
        if (!a.isTrashed() && mimePermitido_(a.getMimeType())) adicionar(a, sub.getName());
      }
    }

    // 2) PDFs/Word cujo nome contém o termo (e que estejam dentro da pasta autorizada)
    if (resultados.length < LIMITE_RESULTADOS) {
      var busca = DriveApp.searchFiles(
        "title contains '" + q + "' and (mimeType = '" + MIME_PDF + "' or mimeType = '" + MIME_DOCX + "') and trashed = false"
      );
      var verificados = 0;
      while (busca.hasNext() && resultados.length < LIMITE_RESULTADOS && verificados < 300) {
        var arq = busca.next();
        verificados++;
        if (vistos[arq.getId()]) continue;
        var nomePasta = arquivoPertenceARaiz_(arq, cache);
        if (nomePasta !== null) adicionar(arq, nomePasta);
      }
    }

    return { sucesso: true, arquivos: resultados };
  } catch (e) {
    return { sucesso: false, erro: e.toString() };
  }
}

/**
 * Baixa o arquivo em Base64 — SOMENTE se for PDF ou Word (.docx) dentro da pasta de termos
 */
function obterPdfBase64Drive(fileId) {
  try {
    var arquivo = DriveApp.getFileById(fileId);

    if (!mimePermitido_(arquivo.getMimeType())) {
      return { sucesso: false, erro: "Arquivo não é PDF nem Word (.docx)." };
    }
    if (arquivoPertenceARaiz_(arquivo, {}) === null) {
      return { sucesso: false, erro: "Arquivo fora da pasta autorizada." };
    }

    return {
      sucesso: true,
      nome: arquivo.getName(),
      mime: arquivo.getMimeType(),
      base64: Utilities.base64Encode(arquivo.getBlob().getBytes())
    };
  } catch (e) {
    return { sucesso: false, erro: e.toString() };
  }
}