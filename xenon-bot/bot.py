from __future__ import annotations

import html
import logging
import os
from pathlib import Path
from tempfile import NamedTemporaryFile

import requests
from dotenv import load_dotenv
from telegram import Update
from telegram.constants import ChatAction, ParseMode
from telegram.ext import Application, CommandHandler, ContextTypes, MessageHandler, filters


logger = logging.getLogger(__name__)


def load_settings() -> dict:
    load_dotenv(Path(__file__).with_name('.env'))

    token = os.getenv('TELEGRAM_BOT_TOKEN', '').strip()
    backend_api = os.getenv('BACKEND_API_URL', 'http://127.0.0.1:8000').strip().rstrip('/')
    max_file_mb = int(os.getenv('MAX_FILE_SIZE_MB', '20'))
    request_timeout_sec = int(os.getenv('REQUEST_TIMEOUT_SEC', '120'))
    poll_interval = float(os.getenv('POLL_INTERVAL', '1.0'))

    if not token:
        raise RuntimeError('TELEGRAM_BOT_TOKEN is required. Set it in xenon-bot/.env.')

    return {
        'token': token,
        'backend_api': backend_api,
        'max_file_mb': max_file_mb,
        'request_timeout_sec': request_timeout_sec,
        'poll_interval': poll_interval,
    }


def format_report_text(report: dict, source_filename: str, report_text: str) -> str:
    result = str(report.get('result', 'UNKNOWN')).upper()
    badge = 'PASS' if result == 'PASS' else 'FAIL'

    lines = [
        f'<b>Xenon Ventilation Report: {badge}</b>',
        f'File: <code>{html.escape(source_filename)}</code>',
        f'Schema: {html.escape(str(report.get("schema", "UNKNOWN")))}',
        f'Rooms (IfcSpace): {report.get("rooms_found", 0)}',
        f'Windows (IfcWindow): {report.get("windows_found", 0)}',
        f'Room Area: {report.get("total_room_area", 0)} m^2',
        f'Window Area: {report.get("total_window_area", 0)} m^2',
        f'Ventilation Ratio: {report.get("ventilation_percent", 0)}%',
        f'Status: {html.escape(str(report.get("status", "")))}',
        '',
        '<b>Raw Report</b>',
        f'<pre>{html.escape(report_text.strip())}</pre>',
    ]
    return '\n'.join(lines)


def format_suggestions_text(suggestions: list[dict]) -> str:
    if not suggestions:
        return ''

    lines = ['<b>AI Suggestions</b>']
    for item in suggestions[:5]:
        title = html.escape(str(item.get('title', 'Suggestion')))
        detail = html.escape(str(item.get('detail', '')))
        suggestion_type = html.escape(str(item.get('type', 'info')).upper())
        lines.append(f'\n- <b>{suggestion_type}</b>: {title}\n{detail}')

    return '\n'.join(lines)


def chunk_message(text: str, max_length: int = 3900) -> list[str]:
    if len(text) <= max_length:
        return [text]

    chunks: list[str] = []
    start = 0
    while start < len(text):
        end = min(start + max_length, len(text))
        if end < len(text):
            split = text.rfind('\n', start, end)
            if split > start:
                end = split
        chunks.append(text[start:end])
        start = end
        if start < len(text) and text[start] == '\n':
            start += 1
    return chunks


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await update.message.reply_text(
        'Send me an IFC file (.ifc) and I will run the Xenon ventilation check and return the report.'
    )


async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await update.message.reply_text(
        'How to use:\n'
        '1. Upload an IFC file as a document.\n'
        '2. Wait for analysis.\n'
        '3. Receive PASS/FAIL report and AI suggestions.\n\n'
        'Tip: Keep IFC files under the configured MAX_FILE_SIZE_MB.'
    )


async def health_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    settings = context.application.bot_data['settings']
    backend_api = settings['backend_api']
    try:
        response = requests.get(f'{backend_api}/health', timeout=10)
        if response.ok:
            await update.message.reply_text(f'Backend is reachable at {backend_api}')
        else:
            await update.message.reply_text(
                f'Backend responded with status {response.status_code} at {backend_api}'
            )
    except Exception as exc:
        await update.message.reply_text(f'Backend is not reachable: {exc}')


async def handle_document(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    message = update.message
    if not message or not message.document:
        return

    document = message.document
    filename = document.file_name or 'upload.ifc'
    ext = Path(filename).suffix.lower()

    if ext != '.ifc':
        await message.reply_text('Please upload a file with .ifc extension.')
        return

    settings = context.application.bot_data['settings']
    max_bytes = settings['max_file_mb'] * 1024 * 1024

    if document.file_size and document.file_size > max_bytes:
        await message.reply_text(
            f'File is too large ({document.file_size} bytes). Limit is {settings["max_file_mb"]} MB.'
        )
        return

    backend_api = settings['backend_api']
    timeout_sec = settings['request_timeout_sec']

    await context.bot.send_chat_action(chat_id=message.chat_id, action=ChatAction.TYPING)
    await message.reply_text('IFC received. Running Xenon ventilation analysis...')

    temp_path: Path | None = None
    try:
        telegram_file = await context.bot.get_file(document.file_id)
        with NamedTemporaryFile(delete=False, suffix='.ifc') as temp_file:
            temp_path = Path(temp_file.name)

        await telegram_file.download_to_drive(custom_path=str(temp_path))

        with temp_path.open('rb') as f:
            response = requests.post(
                f'{backend_api}/analyze',
                files={'file': (filename, f, 'application/octet-stream')},
                data={
                    'send_email': 'false',
                    'recipients': '',
                    'email_subject_prefix': 'Xenon Telegram Report',
                },
                timeout=timeout_sec,
            )

        try:
            payload = response.json()
        except ValueError:
            payload = {'detail': response.text}

        if not response.ok:
            detail = payload.get('detail', f'HTTP {response.status_code}')
            await message.reply_text(f'Analysis failed: {detail}')
            return

        report = payload.get('report') or {}
        report_text = str(payload.get('report_text', '')).strip()
        suggestions = payload.get('suggestions') or []

        report_message = format_report_text(report, filename, report_text)
        for part in chunk_message(report_message):
            await message.reply_text(part, parse_mode=ParseMode.HTML)

        suggestions_message = format_suggestions_text(suggestions)
        if suggestions_message:
            for part in chunk_message(suggestions_message):
                await message.reply_text(part, parse_mode=ParseMode.HTML)

    except requests.Timeout:
        await message.reply_text('Analysis timed out. Please try again with a smaller file or increase timeout.')
    except Exception as exc:
        logger.exception('Failed to process IFC upload')
        await message.reply_text(f'Unexpected error while analyzing IFC: {exc}')
    finally:
        if temp_path and temp_path.exists():
            temp_path.unlink(missing_ok=True)


async def handle_non_ifc(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.message:
        await update.message.reply_text('Send an IFC file (.ifc) as a document to generate the report.')


def main() -> None:
    logging.basicConfig(
        format='%(asctime)s | %(name)s | %(levelname)s | %(message)s',
        level=logging.INFO,
    )

    settings = load_settings()

    application = Application.builder().token(settings['token']).build()
    application.bot_data['settings'] = settings

    application.add_handler(CommandHandler('start', start))
    application.add_handler(CommandHandler('help', help_command))
    application.add_handler(CommandHandler('health', health_command))
    application.add_handler(MessageHandler(filters.Document.ALL, handle_document))
    application.add_handler(MessageHandler(filters.ALL & ~filters.Document.ALL, handle_non_ifc))

    application.run_polling(poll_interval=settings['poll_interval'])


if __name__ == '__main__':
    main()
