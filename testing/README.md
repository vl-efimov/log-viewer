# Testování aplikace LuVo - Log Viewer

Tento dokument shrnuje testovací strategii projektu, používané datasety, způsob spouštění automatických testů a interpretaci výstupních reportů.

## 1. Rozdělení testování

Testování je rozděleno do čtyř samostatných částí:

- frontendové manuální testování menších souborů a uživatelských workflow,
- backendové automatické testy pro velké soubory,
- backendové automatické testy detekce anomálií,
- samostatné manuální ověření online a offline režimu.

Toto rozdělení odpovídá skutečnému chování aplikace:

- menší soubory se v běžném workflow zpracovávají lokálně ve frontendu,
- velké soubory se zpracovávají přes backend,
- detekce anomálií je backendová funkcionalita dostupná pouze online.

## 2. Předpoklady pro spuštění

Před spuštěním testů platí stejné požadavky jako pro spuštění celého projektu. Aktuální seznam systémových požadavků, závislostí a provozních předpokladů je uveden v README v kořeni repozitáře.

Testovací skripty předpokládají, že je aplikace již spuštěna standardním způsobem a že backend je dostupný na adrese `http://127.0.0.1:8001`.

Spuštění projektu:

```bash
.\start.cmd
```

Před spuštěním testů je potřeba nainstalovat závislosti:

```bash
pip install -r testing/requirements.txt
```

Po spuštění projektu lze následně spouštět jednotlivé testovací skripty ze složky `testing` podle pokynů v dalších sekcích tohoto dokumentu.

## 3. Struktura testovací složky

Hlavní soubory a jejich role:

- `run_functional_tests.py`: backendové funkční testy pro velké soubory,
- `run_performance_tests.py`: backendové výkonové testy pro velké soubory,
- `run_anomaly_integration.py`: backendové integrační testy detekce anomálií,
- `run_all_tests.py`: hromadné spuštění backendových automatických testů a generování summary,
- `build_test_summary.py`: vytvoření souhrnného Markdown reportu,
- `config/backend-large-datasets.json`: výchozí datasety pro backend large-file testy,
- `config/anomaly-datasets.json`: výchozí datasety pro backend anomaly testy,
- `reports/`: výstupní JSON a Markdown reporty.

## 4. Použité datasety

### 4.1 Datasety pro frontendové manuální testování

Tyto soubory jsou vhodné pro lokální práci ve frontendu a pro stručné manuální ověření hlavních uživatelských workflow.

| Dataset | Soubor | Parser | Zdroj |
| --- | --- | --- | --- |
| Apache | `log-samples/Apache_2k.log` | built-in `apache` | [Loghub](https://github.com/logpai/loghub) |
| Linux (Syslog) | `log-samples/Linux_2k.log` | built-in `syslog` | [Loghub](https://github.com/logpai/loghub) |
| HDFS (Small) | `log-samples/HDFS_2k.log` | built-in `hdfs` | [Loghub](https://github.com/logpai/loghub) |
| BGL (Small) | `log-samples/BGL_2k.log` | built-in `bgl` | [Loghub](https://github.com/logpai/loghub) |
| Thunderbird (Custom Format) | `log-samples/Thunderbird_2k.log` | vlastní `parser_pattern` | [Loghub](https://github.com/logpai/loghub) |

### 4.2 Datasety pro backendové testy velkých souborů

Tyto soubory se používají v automatických backendových testech zaměřených na ingest, filtrování a dashboard nad velkými daty.

| Dataset | Soubor | Parser | Zdroj |
| --- | --- | --- | --- |
| Web Access (Large) | `log-samples/Large/access.log` | built-in `web-access-generic` | [Kaggle](https://www.kaggle.com/datasets/eliasdabbas/web-server-access-logs?resource=download) |
| HDFS (Large) | `log-samples/Large/HDFS.log` | built-in `hdfs` | [Zenodo](https://zenodo.org/records/8196385) |
| BGL (Large) | `log-samples/Large/BGL.log` | built-in `bgl` | [Zenodo](https://zenodo.org/records/8196385) |

### 4.3 Datasety pro backendové testy detekce anomálií

Tyto soubory se používají pro integrační ověření backendové detekce anomálií.

| Dataset | Soubor | Model | Zdroj |
| --- | --- | --- | --- |
| HDFS (Small) | `log-samples/HDFS_2k.log` | `hdfs` | [Loghub](https://github.com/logpai/loghub) |
| BGL (Small) | `log-samples/BGL_2k.log` | `bgl` | [Loghub](https://github.com/logpai/loghub) |
| BGL (Large) | `log-samples/Large/BGL.log` | `bgl` | [Zenodo](https://zenodo.org/records/8196385) |

## 5. Co je testováno

### 5.1  Plán frontendové manuální testování

Tato část pokrývá hlavní uživatelská workflow nad menšími soubory. Ověřuje se zejména:

- nahrání souboru,
- rozpoznání formátu,
- definice vlastního formátu pomocí regexu,
- náhled parsovaných dat při práci s vlastním formátem,
- uložení a opětovné použití vlastního parseru,
- zobrazení načtených dat,
- dashboard a základní vizualizace,
- filtrování v UI,
- vyhledávání a orientace v datech,
- reakce dashboardu na změnu filtrů,
- základní responzivita desktopového a tabletového rozložení.

### 5.2 Backendové automatické testy pro velké soubory

Tato část ověřuje serverovou část workflow pro rozsáhlé datasety. Automaticky se kontroluje zejména:

- založení ingest session včetně korektní odpovědi backendu,
- upload souboru po blocích včetně potvrzení každého chunku,
- dokončení ingest procesu včetně přechodu datasetu do stavu `ready`,
- získání počtu řádků,
- načtení ukázkového rozsahu dat,
- filtrování podle textu,
- vytvoření dashboard snapshotu,
- vytvoření přesného dashboard snapshotu,
- měření latencí hlavních backendových operací.

### 5.3 Backendové automatické testy detekce anomálií

Tato část ověřuje backendovou integraci detekce anomálií. Automaticky se kontroluje zejména:

- dostupnost modelu,
- spuštění predikce nad ingestovaným datasetem,
- korektní odpověď backendu,
- přítomnost očekávaných polí ve výsledku,
- použitelnost vrácené struktury pro další práci v aplikaci.

### 5.4 Plán manuálního testování online a offline režimu

Online a offline chování není součástí automatických backendových běhů. Ověřuje se samostatně manuálně.

Kontrolované oblasti:

- otevření lokálního souboru bez backendu,
- parsování a vizualizace offline,
- dostupnost PWA po instalaci,
- očekávaná nedostupnost backend-dependent funkcí offline,
- dostupnost anomaly funkcí pouze online.

## 6. Jak testy spouštět

### 6.1 Spuštění všech backendových automatických testů

Pro backendové testy velkých souborů je navíc nutné mít rozbalené velké datasety ve složce `log-samples/Large`. Pokud jsou soubory dostupné pouze v archivu `log-samples/Large.rar`, je třeba tento archiv před spuštěním testů rozbalit tak, aby ve složce `log-samples/Large` byly dostupné soubory `access.log`, `HDFS.log` a `BGL.log`.

```bash
python testing/run_all_tests.py --warmup
```

Tento příkaz postupně spustí:

1. backendové funkční testy velkých souborů,
2. backendové výkonové testy velkých souborů,
3. backendové anomaly integrační testy,
4. generování souhrnného Markdown reportu.

### 6.2 Spuštění jednotlivých backendových částí

Backendové funkční testy:

```bash
python testing/run_functional_tests.py
```

Backendové výkonové testy:

```bash
python testing/run_performance_tests.py
```

Backendové anomaly testy:

```bash
python testing/run_anomaly_integration.py --warmup
```

Generování summary reportu:

```bash
python testing/build_test_summary.py
```

## 7. Kde hledat výsledky

Výstupy automatických běhů jsou ukládány do složky `testing/reports`.

Hlavní reporty:

- `functional-report.json`: backendové funkční testy velkých souborů,
- `performance-report.json`: backendové výkonové testy velkých souborů,
- `anomaly-report.json`: backendové anomaly integrační testy,
- `testing-summary-report.md`: souhrnný report kombinující manuální části a automatické výsledky.

## 8. Jak interpretovat výsledky automatických testů

### 8.1 `functional-report.json`

Tento report ukazuje, zda backendový ingest workflow nad velkými datasety proběhl korektně.

Důležité položky:

- `status`: očekávaná hodnota je `passed`,
- `line_count`: počet zpracovaných neprázdných řádků,
- `filter_total_matches`: počet nalezených řádků při filtrování,
- `dashboard_keys`: přítomnost klíčových částí dashboardu,
- `exact_dashboard_keys`: přítomnost klíčů v přesném dashboardu.

### 8.2 `performance-report.json`

Tento report obsahuje latence backendových operací nad velkými datasety.

Důležité položky:

- `ingest`,
- `line_count`,
- `dashboard`,
- `dashboard_exact`,
- `filter_message`.

Nižší hodnoty znamenají rychlejší odezvu. Při porovnávání mezi datasety je vhodné sledovat i normalizované hodnoty na 1000 řádků.

### 8.3 `anomaly-report.json`

Tento report ověřuje, že backendová detekce anomálií vrací strukturu použitelnou pro aplikaci.

Důležité položky:

- `prediction_completed`,
- `response_has_meta`,
- `response_has_rows`,
- `response_has_anomaly_regions`,
- `predicted_anomaly_lines`,
- `anomaly_regions`.

Tento report nehodnotí kvalitu modelu, ale správnost backendové integrace.

### 8.4 `testing-summary-report.md`

Souhrnný Markdown report kombinuje:

- stručný odkaz na manuální části testování,
- výsledky backendových large-file testů,
- výsledky backendových anomaly testů.

## 9. Omezení testovací strategie

- frontendové workflow nad malými soubory není součástí backendových automatických běhů,
- online/offline scénáře zůstávají manuální,
- anomaly testy ověřují integraci, nikoli kvalitu modelu,
- výsledky výkonu závisí na konkrétním hardwaru a provozním zatížení.

