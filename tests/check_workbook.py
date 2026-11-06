"""Independently validate the generated fixture; optionally read it with openpyxl."""
import argparse
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZipFile

parser = argparse.ArgumentParser()
parser.add_argument('workbook', type=Path)
parser.add_argument('--reader', action='store_true', help='also require openpyxl readback')
args = parser.parse_args()
ns = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
with ZipFile(args.workbook) as archive:
    assert archive.testzip() is None
    for name in archive.namelist():
        ET.fromstring(archive.read(name))
    root = ET.fromstring(archive.read('xl/worksheets/sheet1.xml'))
    rows = root.findall('.//s:row', ns)
    assert len(rows) == 3003
    assert rows[1].findall('s:c/s:is/s:t', ns)[0].text == '00001'
    assert rows[1].findall('s:c/s:is/s:t', ns)[1].text == ' a\r\nb & < 😀 '
    assert rows[2].findall('s:c/s:is/s:t', ns)[0].text == '=1+1'
    assert rows[2].findall('s:c/s:is/s:t', ns)[1].text == 'literal _x005F_x0041_'
    assert rows[-1].findall('s:c/s:is/s:t', ns)[0].text == '2999'
print('ZIP CRCs, XML, row count, whitespace, Unicode and cell text passed.')
if args.reader:
    from openpyxl import load_workbook
    workbook = load_workbook(args.workbook, read_only=True)
    sheet = workbook.active
    values = list(sheet.values)
    assert len(values) == 3003
    assert values[1] == ('00001', ' a\r\nb & < 😀 '), values[1]
    assert values[2][0] == '=1+1'
    assert sheet['A3'].data_type == 's'
    assert values[-1] == ('2999', 'value 2999')
    workbook.close()
    print('Independent openpyxl readback passed (string cell types included).')
