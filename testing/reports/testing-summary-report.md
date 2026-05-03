# Souhrnný report testování

Tento souhrnný report kombinuje manuální frontendové plány a automatické backendové reporty uložené ve složce testing/reports.

## Frontendové manuální testování

Frontendové scénáře nejsou součástí automatických backendových běhů.
Manuální ověření je popsáno v souborech:

- testing/frontend-manual-test-plan.md
- testing/online-offline-manual-checklist.md

Tyto plány pokrývají lokální práci s menšími soubory, vlastní regex parser, vizualizaci v UI, PWA a online/offline scénáře.
## Testování aplikace

### Funkční testy velkých souborů

- Spuštěno datasetů: 3
- Úspěšných běhů: 3
- Neúspěšných běhů: 0

| Dataset | Status | Line count | Filter matches | Dashboard keys |
| --- | --- | --- | --- | --- |
| Web Access (Large) | passed | 10365152 | 10 | kind, sampledLines, sessionId, stats, updatedAt |
| HDFS (Large) | passed | 11175629 | 10 | kind, sampledLines, sessionId, stats, updatedAt |
| BGL (Large) | passed | 4747963 | 10 | kind, sampledLines, sessionId, stats, updatedAt |

### Výkon backendu pro velké soubory

| Dataset | Line count | Ingest ms | Dashboard ms | Exact dashboard ms | Filter ms |
| --- | --- | --- | --- | --- | --- |
| Web Access (Large) | 10365152 | 261825.557 | 4281.799 | 2556.406 | 30.799 |
| HDFS (Large) | 11175629 | 239384.661 | 3403.674 | 1975.831 | 21.729 |
| BGL (Large) | 4747963 | 100676.925 | 1527.896 | 947.907 | 22.837 |

Souhrn latencí:

| Operation | Count | Min ms | Max ms | Avg ms |
| --- | --- | --- | --- | --- |
| ingest | 3 | 100676.925 | 261825.557 | 200629.048 |
| dashboard | 3 | 1527.896 | 4281.799 | 3071.123 |
| dashboard_exact | 3 | 947.907 | 2556.406 | 1826.714 |
| filter_message | 3 | 21.729 | 30.799 | 25.122 |

## Datasety pro backendové testy

### Použitá sada

- Backend functional a performance běhy používají pouze velké datasety definované v testing/config/backend-large-datasets.json.
- Tyto scénáře reprezentují serverovou část workflow pro rozsáhlé logové soubory.

### Přehled datasetů a výsledků

| Dataset | File | File size | Line count | Status | Dashboard ms | Filter ms |
| --- | --- | --- | --- | --- | --- | --- |
| BGL (Large) | BGL.log | 708.76 MB | 4747963 | passed | 1527.896 | 22.837 |
| HDFS (Large) | HDFS.log | 1.47 GB | 11175629 | passed | 3403.674 | 21.729 |
| Web Access (Large) | access.log | 3.26 GB | 10365152 | passed | 4281.799 | 30.799 |

## Backendová detekce anomálií

### Ověření integrační funkčnosti

| Dataset | Status | Prediction | Meta | Rows | Regions | Predicted lines | Region count |
| --- | --- | --- | --- | --- | --- | --- | --- |
| HDFS (Anomaly) | completed | True | True | True | True | 220 | 10 |
| BGL (Anomaly) | completed | True | True | True | True | 900 | 9 |
| BGL (Large) | completed | True | True | True | True | 1481523 | 2746 |

### Poznámky k výsledku

- HDFS (Anomaly): predicted lines sample = [421, 422, 423, 424, 425, 426, 427, 428, 429, 430]; This run validates the backend anomaly workflow and the response shape consumed by the application.
- BGL (Anomaly): predicted lines sample = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]; This run validates the backend anomaly workflow and the response shape consumed by the application.
- BGL (Large): predicted lines sample = [4901, 4902, 4903, 4904, 4905, 4906, 4907, 4908, 4909, 4910]; This run validates the backend anomaly workflow and the response shape consumed by the application.
