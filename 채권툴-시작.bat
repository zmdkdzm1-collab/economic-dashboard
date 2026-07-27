@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo ==========================================
echo    채권 퀀트 툴을 시작합니다
echo ==========================================
echo.
echo [1/3] 필요한 라이브러리 설치 (처음 한 번만, 잠깐 걸려요)...
py -m pip install openpyxl --quiet
echo.
echo [2/3] 경쟁사 데이터 생성 중...
py scripts\build-peer-composites.py
echo.
echo [3/3] 브라우저를 엽니다...
start "" http://127.0.0.1:8099/bond-quant.html
echo.
echo ==========================================
echo    툴이 실행 중입니다.
echo    다 쓰시면 이 검은 창을 닫으세요 (닫으면 종료).
echo ==========================================
echo.
py -m http.server 8099
