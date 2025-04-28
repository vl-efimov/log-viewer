APP_MODULE=app.main:app
HOST=127.0.0.1
PORT=8000

run:
	uvicorn $(APP_MODULE) --host $(HOST) --port $(PORT) --reload

install:
	pip install -r requirements.txt

env:
	cp .env.example .env

check:
	python --version
	pip --version

clean:
	find . -type d -name "__pycache__" -exec rm -r {} +
