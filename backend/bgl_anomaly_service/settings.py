from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[1]
NEURALLOG_MAIN_DIR = BASE_DIR / "NeuralLog-main"
SAVED_MODELS_DIR = BASE_DIR / "NeuralLog" / "saved_models"
BGL_MODEL_PATH = SAVED_MODELS_DIR / "bgl_transformer.hdf5"
HDFS_MODEL_PATH = SAVED_MODELS_DIR / "hdfs_transformer.hdf5"

MODEL_CATALOG = {
	"bgl": {
		"id": "bgl",
		"name": "NeuralLog Transformer (BGL)",
		"dataset": "BGL",
		"model_path": BGL_MODEL_PATH,
	},
	"hdfs": {
		"id": "hdfs",
		"name": "NeuralLog Transformer (HDFS)",
		"dataset": "HDFS",
		"model_path": HDFS_MODEL_PATH,
	},
}

DEFAULT_MODEL_ID = "bgl"

EMBED_DIM = 768
WINDOW_SIZE = 20
MAX_LEN = 75
FF_DIM = 2048
NUM_HEADS = 12
DROPOUT = 0.1

DEFAULT_STEP_SIZE = 20
DEFAULT_THRESHOLD = 0.6
DEFAULT_MIN_REGION_LINES = 1

ANOMALY_SHADE_COLOR = "rgba(255,182,193,0.35)"
