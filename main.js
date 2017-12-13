const csv=require('csvtojson')
const fs = require('fs');
const moment = require('moment');
const puppeteer = require('puppeteer');

// from: https://github.com/GoogleChrome/puppeteer/issues/537#issuecomment-334918553
async function xpath(page, path) {
    const resultsHandle = await page.evaluateHandle(path => {
        let results = [];
        let query = document.evaluate(path, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        for (let i=0, length = query.snapshotLength; i < length; ++i) {
            results.push(query.snapshotItem(i));
        }
        return results;
    }, path);
    const properties = await resultsHandle.getProperties();
    const result = [];
    const releasePromises = [];
    for (const property of properties.values()) {
        const element = property.asElement();
        if (element)
            result.push(element);
        else
            releasePromises.push(property.dispose());
    }
    await Promise.all(releasePromises);
    return result;
}

async function waitForLoader(page) {
    console.log("Waiting for loader to disappear");
    await page.waitFor('.cmpLoaderOver', {hidden: true});
    console.log("Loader is gone")
}

async function clickXPath(page, path) {
    console.log("Clicking on " + path)
    await page.waitFor(3000);
    const [handle] = await xpath(page, path);
    await handle.click()

}

async function readAccountBalance(page) {
    const textContent = await page.evaluate(() => document.querySelector('.numberPrimary').textContent);
    const without_currency = textContent.trim().slice(0, -3);
    const normalized = without_currency.replace(' ', '').replace(',', '.');
    return parseFloat(normalized)
}


function parseTx(t, f) {

    function parseAmount(s) {
        return parseFloat(s.replace(' ','').replace(',','.'))
    }

    function parseDate(d) {
        return moment(d, "DD-MM-YYYY").format("YYYY-MM-DD");
    }

    function parseModality(t) {
        switch(t) {
            case 'Odchozí platba':
                return 'wire';
            case 'Platba kartou':
                return 'card';
            case 'Příchozí platba':
                return 'wire';
            case 'Karetní transakce (nezaúčtováno)':
                return 'card';
            case 'Vrácení peněz':
                return 'refund';
            case 'Výběr hotovosti':
                return 'card';
            default:
                process.exit(1)
        }
    }

    return {
        'account_number': f.slice(8, 18) + "/3030",
        'modality': parseModality(t['Typ platby']) || null,
        'payment_made_at': parseDate(t['Datum provedení']) || null,
        'amount': parseAmount(t['Částka v měně účtu']) || null,
        'currency': t['Měna účtu'] || null,
        'fee': parseAmount(t['Poplatek v měně účtu']) || 0,
        'primary_amount': parseAmount(t['Původní částka platby']) || null,
        'primary_currency': t['Původní měna platby'] || null,
        'counterparty_account_label': t['Název protistrany'] || null,
        'counterparty_account_number': t['Číslo účtu protistrany'] || null,
        'counterparty_account_name': t['Název účtu protistrany'] || null,
        'comment_for_sender': t['Poznámka pro mne'] || null,
        'comment_for_recipient': t['Zpráva pro příjemce'] || null,
        'comment': t['Zpráva pro příjemce'] || null,
        'business_description': t['Obchodní místo'] || null,
        'exchange_rate': parseAmount(t['Směnný kurz']) || null,
    }
}

function parseTransactions() {
    return new Promise((res, err) => {
        fs.readdir('./download', (err, files) => {
            files.forEach(f => {
                csv({
                    delimiter: ";",
                    quote: '"',
                    trim: true
                }).fromFile('./download/' + f).on('json', (raw_tx)=>{
                    return parseTx(raw_tx, f)
                }).on('done', (all_tx) => {
                    res(all_tx)
                })
            })
        })

    })
}

(async () => {

    const argv = require('minimist')(process.argv.slice(2));

    const number = argv['account-number'];

    console.log("Opening login page", process.env.AIRBANK_USERNAME);
    const browser = await puppeteer.launch({args: ['--no-sandbox', '--disable-setuid-sandbox']});
    const page = await browser.newPage();
    await page.goto('https://ib.airbank.cz/');

    console.log("Logging in");
    await page.waitFor('input[type="text"]');
    await page.type('input[type="text"]',  process.env.AIRBANK_USERNAME);
    await page.type('input[type="password"]', process.env.AIRBANK_PASSWORD + String.fromCharCode(13));

    await waitForLoader(page);

    await clickXPath(page, '//span[text()="Účty a karty"]');
    await clickXPath(page, '//*[text()="' + number + '"]');

    const balance = await readAccountBalance(page);
    console.log(balance);

    await clickXPath(page, '//a[./span[text()="Historie plateb"]]');
    await clickXPath(page, '//a[span[text()="Podrobné vyhledávání"]]');
    await clickXPath(page, '//a[span[text()="Hledat"]]');
    await page._client.send('Page.setDownloadBehavior', {behavior: 'allow', downloadPath: './download'})
    await clickXPath(page, '//span[text()="Exportovat"]');
    await page.waitFor(1000*10);

    await fs.accessSync('./download');
    await page.close();
    await browser.close();

})().then().catch((e) => {
    console.error(e)
});


