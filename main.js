const csv=require('csvtojson');
const fs = require('fs');
const Apify = require('apify');

async function waitForLoader(page) {
    console.log("Waiting for loader to disappear");
    await page.waitFor('.cmpLoaderOver', {hidden: true});
    console.log("Loader is gone")
}

async function clickXPath(page, path) {
    console.log(`Waiting for ${path} (also waiting a few seconds to be sure)`);
    await page.waitForXPath(path);
    await page.waitFor(5000);
    buttons = await page.$x(path);
    console.log("Clicking on " + path)
    await buttons[0].click()

}

async function readAccountBalance(page) {
    const el = await page.$('.numberPrimary');
    const textContent = await page.evaluate(el => el.innerHTML, el);
    const trimmed = textContent.replace(/\s/g,'').replace(/&nbsp;/g, '');
    console.log(trimmed);
    const without_currency = trimmed.slice(0, -3);
    const normalized = without_currency.replace(/\s/g,'').replace(',', '.');
    return parseFloat(normalized)
}


async function parseTransactions() {
    const files = fs.readdirSync('./download');
    const parsed = files.map(f => {
        return csv({quote:'"', delimiter:';'})
            .fromFile('./download/' + f)
            .then((txs) => {
                return txs.map(tx => {
                    tx['Číslo účtu'] = f.slice(8,18) + '/3030';
                    return tx
                })
            })
    });
    return Promise.all(parsed)
}


async function getBrowserPage () {
    const headless = process.env.HEADLESS !== "false";
    const browser = await Apify.launchPuppeteer({headless});
    return browser.newPage();
}

// https://stackoverflow.com/questions/10865025/merge-flatten-an-array-of-arrays-in-javascript/39000004#39000004
const flatten = function(arr, result = []) {
    for (let i = 0, length = arr.length; i < length; i++) {
        const value = arr[i];
        if (Array.isArray(value)) {
            flatten(value, result);
        } else {
            result.push(value);
        }
    }
    return result;
};

Apify.main(async () => {

    const user_name = process.env.AIRBANK_USERNAME;
    if (!user_name) throw new Error("username not set");

    const password = process.env.AIRBANK_PASSWORD;
    if (!password) throw new Error("password not set");

    const input = await Apify.getValue('INPUT');
    const account_numbers = input.account_numbers;
    if (!account_numbers) throw new Error('account nrs not set');
    console.log(account_numbers);

    console.log("Opening login page");
    const page = await getBrowserPage();
    await page.goto('https://ib.airbank.cz/');

    console.log("Logging in");
    await page.waitFor('input[type="text"]');
    await page.type('input[type="text"]', user_name);
    await page.type('input[type="password"]', password + String.fromCharCode(13));

    await waitForLoader(page);

    let balances = {};
    for (const account_number of account_numbers) {
        console.log(`Scraping: ${user_name}, Numbers: ${account_number}`);
        await clickXPath(page, '//span[text()="Účty a karty"]');
        await page.waitFor(5000);

        let account_tab_query = '//*[text()="' + account_number + '"]';
        let account_tab = await page.$x(account_tab_query);
        if (account_tab.length === 0) {
            console.log(`Account tab for ${account_number} not found, swiping...`);
            await clickXPath(page, '//*[@class="cmpListPageButton next"]');
        }
        await clickXPath(page, account_tab_query);

        let balance = await readAccountBalance(page);
        console.log(`Balance: ${balance}`);
        balances[account_number] = balance;

        await clickXPath(page, '//a[./span[text()="Historie plateb"]]');
        await page._client.send('Page.setDownloadBehavior', {behavior: 'allow', downloadPath: './download'});
        await clickXPath(page, '//span[text()="Exportovat"]');
        const wait_seconds = 10;
        console.log(`Waiting for ${wait_seconds} seconds`);
        await page.waitFor(1000*wait_seconds);
        await clickXPath(page, '//button[@title="close"]')

        let dirExists = fs.existsSync('./download');
        console.log(dirExists ? fs.readdirSync('./download') : "Download dir doesn't exist")

    }

    await fs.accessSync('./download');
    const tx = flatten(await parseTransactions());
    const output = {
        tx: tx,
        balances: balances
    };

    await Apify.setValue('OUTPUT', output);
    await page.close();

});


