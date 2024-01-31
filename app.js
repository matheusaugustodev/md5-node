const express = require('express')
const CryptoJS = require('crypto-js')
const OAuth = require('oauth-1.0a')
const jsQR = require('jsqr')
const Jimp = require('jimp')
const FileType = require('file-type')
const { pdfToPng } = require('pdf-to-png-converter')

const app = express()

app.use(express.json())

const port = process.env.PORT || 3000;

app.listen(port, () => {
    console.log(`Servidor rodando na porta ${port}`);
});

app.get('/', (req, res, next) => {
  res.json({ message: 'Hello world RENAPSI'})
})

app.post('/buscardocumento', async (req, res) => {
  
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0

  try {

    if (!req.body) throw new Error('Corpo da solicitação inválido, faltou alguma informação')

    const servidor = req.body.servidor
    const numDocumento = req.body.numDocumento
    const consumerKey = req.body.consumerKey
    const consumerSecret = req.body.consumerSecret
    const accessToken = req.body.accessToken
    const accessTokenSecret = req.body.accessTokenSecret

    if (!servidor || !numDocumento || !consumerKey || !consumerSecret || !accessToken || !accessTokenSecret) throw new Error('Corpo da solicitação inválido, faltou alguma informação')

    // Configurar as credenciais OAuth
    const oauth = await OAuth({
      consumer: {
        key: consumerKey,
        secret: consumerSecret
      },
      signature_method: 'HMAC-SHA1',
      hash_function: (base_string, key) => {
        return CryptoJS.HmacSHA1(base_string, key).toString(CryptoJS.enc.Base64)
      }
    })

    const apiUrl = `https://${servidor}.rpa.org.br/webdesk/streamcontrol/?WDCompanyId=31909&WDNrDocto=${numDocumento}&WDNrVersao=1000`

    const requestData = {
      url: apiUrl,
      method: 'GET'
    }

    // Gerar as credenciais OAuth
    const oauthHeaders = oauth.toHeader(oauth.authorize(requestData, {
      key: accessToken,
      secret: accessTokenSecret
    }))

    const headers = {
      ...oauthHeaders,
      'Accept': 'application/json, text/plain, */*',
      'Content-Type': 'application/json'
    }

    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: headers
    })

    if (!response.ok) throw new Error('Erro ao buscar arquivo na API do Fluig: ' + response.statusText)

    const blob = await response.blob()
    const arrayBuffer = await blob.arrayBuffer()
    const bufferArquivo = Buffer.from(arrayBuffer)

    if (bufferArquivo.length === 0) throw new Error('arquivo corrompido')
    
    const extensaoArquivo = await buscarExtensaoArquivo(bufferArquivo)

    const tiposAceitos = ['jpg', 'jpeg', 'png', 'pdf']
    
    if (!tiposAceitos.includes(extensaoArquivo)) throw new Error('Formato de arquivo não aceito: ', extensaoArquivo)

    const hash = CryptoJS.MD5(CryptoJS.lib.WordArray.create(bufferArquivo));
    const hashString = hash.toString(CryptoJS.enc.Hex);

    const bufferImagem = extensaoArquivo === 'pdf' ? await buscarBufferImagemDoPDF(bufferArquivo) : bufferArquivo

    const informacaoQRCode = bufferImagem ? await lerQRCode(bufferImagem) : ''

    if (informacaoQRCode) {
      const partesInfo = informacaoQRCode.split('.')
      const listaInfosQRCode = {
        CHAPA: partesInfo[1],
        CPF: partesInfo[2],
        MES: partesInfo[3],
        ANO: partesInfo[4]
      }

      console.log({ MD5: hashString, ...listaInfosQRCode })
      return res.json({ MD5: hashString, ...listaInfosQRCode })
    } else {
      console.log({ MD5: hashString })
      return res.json({ MD5: hashString })
    }

  } catch (error) {
    console.error({ ERROR: error.message })
    res.status(500).json({ ERROR: error.message })
  }




})

async function buscarExtensaoArquivo(buffer) {

  const infosTipoArquivo = await FileType.fromBuffer(buffer)
  const extensao = infosTipoArquivo ? infosTipoArquivo.ext : ''
  return extensao
}

async function buscarBufferImagemDoPDF(buffer) {
    try {

        const pngPage = await pdfToPng(buffer, {
            disableFontFace: false,
            useSystemFonts: false,
            pagesToProcess: [1],
            viewportScale: 2.0
        })

        if (pngPage.length) return null
        else return pngPage[0].content
    } catch (error) {
      console.error('Erro buscarBufferImagemDoPDF() ', error);
    }
} 

async function lerQRCode(bufferImagem) {
  try {

    const imagem = await Jimp.read(bufferImagem)
    const imagemArray = new Uint8Array(imagem.bitmap.data.buffer)

    const conteudoDoQRCode = await jsQR(imagemArray, imagem.bitmap.width, imagem.bitmap.height)

    if (conteudoDoQRCode) return conteudoDoQRCode.data
    else return null

  } catch (error) {
    console.error('Erro lerQRCode() ', error);
  }
}