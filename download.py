# coding=utf-8
from __future__ import print_function
import time
import os
import sys
import tempfile
from shutil import copyfile

from selenium import webdriver
from selenium.common.exceptions import NoSuchElementException
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

import click

TARGET_DATA_FOLDER = os.getenv('AIRBANK_DOWNLOAD_DIR', '/data')
QUIT_CHROME_ON_EXIT = True
PAGE_TRANSITION_WAIT = 10  # seconds
DOWNLOAD_TIMEOUT = 60  # seconds


def eprint(*args, **kwargs):
    print("[ERROR]", *args, file=sys.stderr, **kwargs)

def iprint(*args, **kwargs):
    print("[INFO]", *args, **kwargs)
    sys.stdout.flush()


def wait_for_download(dirname):
    waiting_time = 0
    sleep_interval = 0.1
    def is_downloaded():
        return os.listdir(dirname) and os.listdir(dirname)[0].endswith(".csv")
    while waiting_time < DOWNLOAD_TIMEOUT and not is_downloaded():
        time.sleep(sleep_interval)
        waiting_time += sleep_interval

    if waiting_time >= DOWNLOAD_TIMEOUT:
        eprint("Something went wrong, file download timed out")
        sys.exit(1)




def init_chrome(download_folder):
    iprint("Starting chrome...")
    chrome_options = webdriver.ChromeOptions()
    chrome_options.add_experimental_option('prefs', {
        'download.default_directory': download_folder,
        'download.prompt_for_download': False
    })

    d = webdriver.Chrome(chrome_options=chrome_options)
    d.implicitly_wait(PAGE_TRANSITION_WAIT)
    return d


def quit_chrome(d):
    if QUIT_CHROME_ON_EXIT:
        d.quit()

def wait_for_loader(d):
    iprint("Waiting for the loader screen to disappear ")
    WebDriverWait(d, PAGE_TRANSITION_WAIT).until(
        EC.invisibility_of_element_located((By.CLASS_NAME, 'cmpLoaderOver')))


def click_on(d, xpath):
    iprint("Clicking " + xpath)
    d.find_element_by_xpath(xpath).click()


def read_account_balance(d):
    iprint("Reading account balance")
    balance_text = d.find_element_by_class_name("numberPrimary").text
    without_currency = balance_text.strip()[:-3]
    return float(without_currency.replace(' ', '').replace(',', '.'))


def store_account_balance(balance, filename):
    f = open(os.path.join(TARGET_DATA_FOLDER, filename), 'w')
    iprint("Writing account balance to " + f.name)
    print(balance, file=f)


def is_tx_list_empty(d):
    iprint("Checking for empty transaction list")
    wait_for_loader(d)
    d.find_element_by_xpath('//span[text()="Exportovat"]')
    try:
        d.implicitly_wait(1)
        d.find_element_by_xpath('//*[text()="Žádné platby"]')
        d.implicitly_wait(PAGE_TRANSITION_WAIT)
        return True
    except NoSuchElementException:
        d.implicitly_wait(PAGE_TRANSITION_WAIT)
        return False


def download_with_chrome(
        username, password, period_from, period_to,
        number, filename, balance_filename):

    download_folder = tempfile.mkdtemp()
    d = init_chrome(download_folder)
    try:
        iprint("Loading login page")
        d.get("https://ib.airbank.cz")

        iprint("Logging in")
        d.find_element_by_css_selector('input[type="text"]').send_keys(username)
        d.find_element_by_css_selector('input[type="password"]').send_keys(password, Keys.ENTER)

        wait_for_loader(d)
        click_on(d, '//span[text()="Účty a karty"]')

        wait_for_loader(d)
        click_on(d, '//*[text()="' + number + '"]')
        wait_for_loader(d)

        if balance_filename:
            balance = read_account_balance(d)
            store_account_balance(balance, balance_filename)

        click_on(d, '//a[./span[text()="Historie plateb"]]')
        wait_for_loader(d)
        click_on(d, '//a[span[text()="Podrobné vyhledávání"]]')

        iprint("Filling in transaction filters")
        wait_for_loader(d)
        date_from = d.find_element_by_name('stateOrForm:formContent:dateFrom:componentWrapper:component')
        date_from.clear()
        date_from.send_keys(period_from)

        date_to = d.find_element_by_name('stateOrForm:formContent:dateTo:componentWrapper:component')
        date_to.clear()
        date_to.send_keys(period_to, Keys.ENTER)

        if is_tx_list_empty(d):
            iprint("No transactions found in the given period, quitting...")
            quit_chrome(d)
            sys.exit(0)

        click_on(d, '//span[text()="Exportovat"]')

        iprint("Waiting for file to be ready to download")

        click_on(d, '//a[contains(@href, "ExportCsv")]')

        iprint("Waiting for download to finish (by checking the download folder)")
        wait_for_download(download_folder)

        iprint("Copying downloaded file to the target directory")
        downloaded_filename = os.listdir(download_folder)[0]
        src_file = os.path.join(download_folder, downloaded_filename)
        dst_file = os.path.join(TARGET_DATA_FOLDER, filename or downloaded_filename)
        copyfile(src_file, dst_file)
        iprint("Done! Transaction file is located at " + dst_file)

    finally:
        iprint("Closing chrome")
        quit_chrome(d)


def get_env_var(name):
    if name in os.environ:
        return os.environ[name]
    else:
        eprint("Environmental variable " + name + " not found")
        sys.exit(1)



@click.command()
@click.option('--period-from', help='Date from, format DD.MM.YYYY', required=True)
@click.option('--period-to', help='Date to, format DD.MM.YYYY', required=True)
@click.option('--account-number', help='Bank account number', required=True)
@click.option('--export-filename', help='Name of the downloaded CSV file')
@click.option('--balance-filename', help='Name of the downloaded CSV file')
def run(period_from, period_to, account_number, export_filename, balance_filename):
    """Download a list of transactions from AirBank"""
    download_with_chrome(
        username=get_env_var("AIRBANK_USERNAME"),
        password=get_env_var("AIRBANK_PASSWORD"),
        period_from=period_from,
        period_to=period_to,
        number=account_number,
        filename=export_filename,
        balance_filename=balance_filename
    )


if __name__ == '__main__':
    run()
