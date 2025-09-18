from datetime import datetime
from flask import Flask, render_template, request, redirect, url_for, jsonify, g, flash, send_from_directory, current_app, Response
from flask_mail import Mail, Message
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from flask_httpauth import HTTPBasicAuth
from html import unescape
from urllib.parse import urlparse, unquote
from werkzeug.utils import secure_filename
import json
import logging
import markdown
import os
import random
import re
import sqlite3
import xml.etree.ElementTree as ET

app = Flask(__name__)

# ##########################################################
# Initialize needed variables
# ##########################################################
#export SECRET_KEY="your-secret-key-here"
#export MAIL_USERNAME="italy@gagliano.net"
#export MAIL_PASSWORD="your-app-password"
#export ADMIN_EMAIL="g@gagliano.net"
app.config['CONTENT_FOLDER'] = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'content')
app.config['IMAGES_FOLDER'] = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'images')
app.config['DATADB'] = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'data.db')
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'your-secret-key-here')
app.config['MAIL_SERVER'] = os.environ.get('MAIL_SERVER', 'smtp.gmail.com')
app.config['MAIL_PORT'] = int(os.environ.get('MAIL_PORT', 587))
app.config['MAIL_USE_TLS'] = True
app.config['MAIL_USERNAME'] = os.environ.get('MAIL_USERNAME')
app.config['MAIL_PASSWORD'] = os.environ.get('MAIL_PASSWORD')
app.config['MAIL_DEFAULT_SENDER'] = os.environ.get('MAIL_DEFAULT_SENDER')
appTitle = "Visit Italy!";
postsPerPage = 10

# ##########################################################
# Initialize extensions
# ##########################################################
mail = Mail(app)
limiter = Limiter(
    key_func=get_remote_address,
    default_limits=[],
    storage_uri="memory://"
)
limiter.init_app(app)
auth = HTTPBasicAuth()

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Admin credentials
users = {'admin': 'password'}  # Change in production

@auth.verify_password
def verify_password(username, password):
    if username in users and users[username] == password:
        return username
    return None

# Custom Jinja2 filter for strftime
@app.template_filter('strftime')
def strftime_filter(dt, fmt='%Y-%m-%d'):
    if isinstance(dt, str):
        return dt
    return dt.strftime(fmt)

# Custom Jinja2 filter for basename
@app.template_filter('basename')
def basename_filter(path):
    return os.path.basename(path)

@app.template_filter('format_date')
def format_date(date_string):
    """Format date string for display in comments"""
    try:
        if isinstance(date_string, str):
            # Try to parse the date string
            date_obj = datetime.fromisoformat(date_string.replace('Z', '+00:00'))
        else:
            date_obj = date_string

        return date_obj.strftime('%m/%d/%Y %I:%M:%S %p')
    except (ValueError, AttributeError):
        return str(date_string)  # Return original if parsing fails

# ##########################################################
# Contacts database functions
# ##########################################################
def saveContact(data, ip_address, user_agent):
    conn = getDataDB()
    cursor = conn.cursor()
    cursor.execute('''
        INSERT INTO contacts
        (firstName, lastName, email, phone, subject, company, image, message, newsLetter, ipAddress, userAgent)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        data['firstName'], data['lastName'], data['email'],
        data.get('phone', ''), data['subject'],
        data.get('company', ''), data.get('image', ''),
        data['message'], 'newsLetter' in data, ipAddress, userAgent
    ))
    conn.commit()
    contact_id = cursor.lastrowid
    conn.close()
    return contact_id

def validateEmail(email):
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return re.match(pattern, email) is not None

def sanitizeInput(text):
    if not text:
        return ''
    # Remove potential HTML/script tags
    text = re.sub(r'<[^>]*>', '', str(text))
    # Limit length
    return text[:1000] if len(text) > 1000 else text

# ##########################################################
# Get Database
# ##########################################################
@app.route("/getdb")
def getdb():
    return send_file(DATADB, as_attachment=True)

# ##########################################################
# Privacy Notice processing application route
# ##########################################################
@app.route('/privacy')
def privacy():
    return render_template('parts/privacy.html')  # Renders HTML partial

# ##########################################################
# About processing application route
# ##########################################################
@app.route('/about')
@app.route('/about/<path:from_path>')
def about(from_path=None):
    # Build breadcrumbs for the about page
    breadcrumbs = []

    if from_path:
        # User came from a specific folder - preserve that path
        # Use the existing build_hierarchical_metadata function to get the full path
        folder_metadata = build_hierarchical_metadata(from_path)
        breadcrumbs = folder_metadata['breadcrumbs'].copy()
    else:
        # Check if there's a referrer path in the request args or session
        referrer_path = request.args.get('from') or request.referrer
        if referrer_path and referrer_path != request.url:
            # Try to extract folder path from referrer URL
            try:
                parsed = urlparse(referrer_path)
                if '/folder/' in parsed.path:
                    folder_path = unquote(parsed.path.replace('/folder/', ''))
                    folder_metadata = build_hierarchical_metadata(folder_path)
                    breadcrumbs = folder_metadata['breadcrumbs'].copy()
            except:
                pass

    # If no specific path context, just use home
    if not breadcrumbs:
        breadcrumbs = [{'name': 'Home', 'path': ''}]

    # Add the About breadcrumb as the final item
    breadcrumbs.append({'name': 'About', 'path': 'about'})

    # Build page metadata for SEO
    page_title = f"About - {appTitle}"
    meta_description = "Learn more about our Italy photo gallery and travel experiences."
    meta_keywords = "about, Italy, travel, photography, gallery"

    # Optional: Get any about-specific content if you have an about.txt file
    about_content = ""
    about_file_path = os.path.join(app.config.get('CONTENT_FOLDER', ''), 'about.txt')
    if os.path.exists(about_file_path):
        about_content = read_text_file(about_file_path)
        if about_content:
            meta_description = about_content

    # Schema.org data for the about page
    schema_data = {
        "@context": "https://schema.org",
        "@type": "AboutPage",
        "name": "About",
        "description": meta_description,
        "url": url_for('about', _external=True)
    }

    return render_template('about.html',
                          breadcrumbs=breadcrumbs,
                          page_title=page_title,
                          meta_description=meta_description,
                          meta_keywords=meta_keywords,
                          schema_json=json.dumps(schema_data, indent=2),
                          about_content=about_content)

# ##########################################################
# Contacts processing application routes and functions
# ##########################################################
@app.route('/contact')
@app.route('/contact/<path:from_path>')
def contact(from_path=None):
    # Build breadcrumbs for the contact page
    breadcrumbs = []

    if from_path:
        # User came from a specific folder - preserve that path
        # Use the existing build_hierarchical_metadata function to get the full path
        folder_metadata = build_hierarchical_metadata(from_path)
        breadcrumbs = folder_metadata['breadcrumbs'].copy()
    else:
        # Check if there's a referrer path in the request args or session
        referrer_path = request.args.get('from') or request.referrer
        if referrer_path and referrer_path != request.url:
            # Try to extract folder path from referrer URL
            try:
                parsed = urlparse(referrer_path)
                if '/folder/' in parsed.path:
                    folder_path = unquote(parsed.path.replace('/folder/', ''))
                    folder_metadata = build_hierarchical_metadata(folder_path)
                    breadcrumbs = folder_metadata['breadcrumbs'].copy()
            except:
                pass

    # If no specific path context, just use home
    if not breadcrumbs:
        breadcrumbs = [{'name': 'Home', 'path': ''}]

    # Add the contact breadcrumb as the final item
    breadcrumbs.append({'name': 'Contact', 'path': 'contact'})

    # Build page metadata for SEO
    page_title = f"Contact - {appTitle}"
    meta_description = "Learn more about our Italy photo gallery and travel experiences."
    meta_keywords = "contact, Italy, travel, photography, gallery"

    about_content = ""
    meta_description = about_content

    # Schema.org data for the contact page
    schema_data = {
        "@context": "https://schema.org",
        "@type": "ContactPage",
        "name": "Contact",
        "description": meta_description,
        "url": url_for('contact', _external=True)
    }

    return render_template('contact.html',
                          breadcrumbs=breadcrumbs,
                          page_title=page_title,
                          meta_description=meta_description,
                          meta_keywords=meta_keywords,
                          schema_json=json.dumps(schema_data, indent=2),
                          about_content=about_content)

@app.route('/contactpage', methods=['POST'])
@limiter.limit("5 per minute")
def contactFormSubmission():
    # Handle contact form submission
    try:
        # Check if request is JSON or form data
        if request.is_json:
            data = request.get_json()
        else:
            data = request.form.to_dict()

        # Validate required fields
        required_fields = ['firstName', 'lastName', 'email', 'subject', 'message']
        for field in required_fields:
            if not data.get(field) or not data[field].strip():
                return jsonify({
                    'success': False,
                    'message': f'{field} is required'
                }), 400

        # Validate email format
        if not validateEmail(data['email']):
            return jsonify({
                'success': False,
                'message': 'Please enter a valid email address'
            }), 400

        # Check privacy agreement - this was missing from your original validation
        if 'privacy' not in data:
            return jsonify({
                'success': False,
                'message': 'You must agree to the privacy policy'
            }), 400

        # Sanitize inputs
        for key in data:
            if isinstance(data[key], str):
                data[key] = sanitizeInput(data[key])

        # Get client info
        ip_address = request.environ.get('HTTP_X_FORWARDED_FOR', request.remote_addr)
        user_agent = request.headers.get('User-Agent', '')

        # Save to database
        contact_id = saveContact(data, ip_address, user_agent)

        # Send email notification
        sendNotificationEmail(data, contact_id)

        # Send confirmation email to user
        sendConfirmationEmail(data)

        logger.info(f"Contact form submitted successfully. ID: {contact_id}")

        return jsonify({
            'success': True,
            'message': 'Thank you for your message! We\'ll get back to you soon.',
            'reference_id': contact_id
        })

    except Exception as e:
        logger.error(f"Error processing contact form: {str(e)}")
        return jsonify({
            'success': False,
            'message': 'An error occurred. Please try again later.'
        }), 500

def sendNotificationEmail(data, contact_id):
    # Send notification eMail to admin
    try:
        subject = f"New Contact Form Submission - {data['subject']} (#{contact_id})"

        body = f"""
        New contact form submission received:

        Reference ID: {contact_id}
        Date: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}

        Contact Information:
        - Name: {data['firstName']} {data['lastName']}
        - Email: {data['email']}
        - Phone: {data.get('phone', 'Not provided')}
        - Company: {data.get('company', 'Not provided')}

        Inquiry Details:
        - Subject: {data['subject']}
        - Budget: {data.get('budget', 'Not specified')}
        - Newsletter: {'Yes' if 'newsletter' in data else 'No'}

        Message:
        {data['message']}

        ---
        This is an automated message from your website contact form.
        """

        msg = Message(
            subject=subject,
            recipients=[os.environ.get('ADMIN_EMAIL', 'admin@yoursite.com')],
            body=body
        )
        mail.send(msg)

    except Exception as e:
        logger.error(f"Failed to send notification email: {str(e)}")

def sendConfirmationEmail(data):
    # Send confirmation email to user
    try:
        subject = "Thank you for contacting us"

        body = f"""
        Dear {data['firstName']},

        Thank you for reaching out to us. We have received your message regarding "{data['subject']}" and will respond within 24 hours during business days.

        Here's a summary of your inquiry:
        - Subject: {data['subject']}
        - Message: {data['message'][:200]}{'...' if len(data['message']) > 200 else ''}

        If you need to reference this inquiry, please mention that you submitted it on {datetime.now().strftime('%Y-%m-%d')}.

        Best regards,
        Your Visit Italy! Team

        ---
        This is an automated confirmation email. Please do not reply to this message.
        """

        msg = Message(
            subject=subject,
            recipients=[data['email']],
            body=body
        )
        mail.send(msg)

    except Exception as e:
        logger.error(f"Failed to send confirmation email: {str(e)}")

@app.route('/contact/status/<int:contact_id>')
def contactStatus(contact_id):
    # Check status of a contact submission
    try:
        conn = getDataDB()
        cursor = conn.cursor()
        cursor.execute('SELECT created_at, subject FROM contacts WHERE id = ?', (contact_id,))
        result = cursor.fetchone()
        conn.close()

        if result:
            return jsonify({
                'success': True,
                'submitted_at': result[0],
                'subject': result[1],
                'status': 'received'
            })
        else:
            return jsonify({
                'success': False,
                'message': 'Contact submission not found'
            }), 404

    except Exception as e:
        logger.error(f"Error checking contact status: {str(e)}")
        return jsonify({
            'success': False,
            'message': 'Error checking status'
        }), 500

# ##########################################################
# Data database functions
# ##########################################################
def getDataDB():
    # Get a data database connection
    if 'db' not in g:
        g.db = sqlite3.connect(app.config['DATADB'])
        g.db.row_factory = sqlite3.Row
    return g.db

@app.teardown_appcontext
def close_db(e=None):
    # Close the database
    db = g.pop('db', None)
    if db is not None:
        db.close()

# ##########################################################
# Helper functions for metadata collection
# ##########################################################
def read_text_file(file_path):
    """Read text file content, return None if file doesn't exist"""
    try:
        if os.path.exists(file_path):
            with open(file_path, 'r', encoding='utf-8') as f:
                return f.read().strip()
    except Exception:
        pass
    return None

def build_hierarchical_metadata(current_path):
    """Build hierarchical metadata by traversing up the directory tree"""
    keywords = []
    breadcrumbs = []

    # Convert to absolute path if it's relative
    if not os.path.isabs(current_path):
        current_path = os.path.join(app.config['CONTENT_FOLDER'], current_path)

    # Build breadcrumbs and collect keywords
    path_parts = []
    relative_path = os.path.relpath(current_path, app.config['CONTENT_FOLDER'])

    if relative_path != '.':
        path_parts = relative_path.split(os.sep)

    # Add home breadcrumb
    breadcrumbs.append({'name': 'Home', 'path': ''})

    # Add intermediate breadcrumbs
    current_rel_path = ''
    for part in path_parts:
        if current_rel_path:
            current_rel_path = os.path.join(current_rel_path, part)
        else:
            current_rel_path = part
        breadcrumbs.append({'name': part, 'path': current_rel_path})

    # Collect keywords from current directory up to root
    current_check_path = current_path
    content_folder = os.path.abspath(app.config['CONTENT_FOLDER'])

    while current_check_path and os.path.commonpath([current_check_path, content_folder]) == content_folder:
        keywords_file = os.path.join(current_check_path, 'keywords.txt')
        keywords_content = read_text_file(keywords_file)

        if keywords_content:
            # Split keywords and add to list (avoiding duplicates)
            folder_keywords = [k.strip() for k in keywords_content.split(',') if k.strip()]
            for keyword in folder_keywords:
                if keyword not in keywords:
                    keywords.append(keyword)

        # Move up one directory
        parent_path = os.path.dirname(current_check_path)
        if parent_path == current_check_path:  # Reached root
            break
        current_check_path = parent_path

    return {
        'keywords': keywords,
        'breadcrumbs': breadcrumbs
    }

def build_page_metadata(folder_path, contents):
    """Build all page metadata in one place"""
    # Get hierarchical metadata
    metadata = build_hierarchical_metadata(folder_path)

    # Get current folder info
    folder_full_path = os.path.join(app.config['CONTENT_FOLDER'], folder_path) if folder_path else app.config['CONTENT_FOLDER']
    folder_name = os.path.basename(folder_path) if folder_path else appTitle

    # Read guide file based on current folder name and return HTML content and meta description.
    about_text = "Guide missing! Check back later."
    logger.info(f"[INFO] folder name: {folder_name}")
    logger.info(f"[INFO] folder path: {folder_path}")
    logger.info(f"[INFO] folder full path: {folder_full_path}")
    if folder_path:
       # Extract the last folder name from the path
        last_folder = os.path.basename(folder_path.rstrip('/'))
        guide_filename = f"{last_folder} Guide.txt"
    else:
        guide_filename = f"Guide.txt"
    logger.info(f"[INFO] guide file: {guide_filename}")
    guide_file_path = os.path.join(folder_full_path, guide_filename)
    logger.info(f"[INFO] full guide file: {guide_file_path}")

    if os.path.exists(guide_file_path):
        about_text = read_text_file(guide_file_path)
    else:
        logger.error(f"[ERROR] Guide file missing: {guide_filename}")

    # Create meta description from HTML content
    meta_description = "Browse our Guides"
    if about_text:
        plain_text = re.sub('<[^<]+?>', '', about_text)
        plain_text = unescape(plain_text).strip()
        meta_description = plain_text[:155] + "..." if len(plain_text) > 155 else plain_text

    folder_name = os.path.basename(folder_path) if folder_path else appTitle

    # Build page metadata
    page_title = f"{folder_name} - " + appTitle if folder_path else appTitle
    meta_keywords = ', '.join(metadata['keywords'][:10]) if metadata['keywords'] else ''

    # Get OG image
    og_image = ''
    if contents['images']:
        og_image = url_for('serveContent', filename=contents['images'][0]['relativePathWithName'])
    elif contents['folders'] and not contents['folders'][0]['thumbnail'].startswith('/static/'):
        og_image = url_for('serveContent', filename=contents['folders'][0]['thumbnail'])

    # Schema.org data
    schema_data = {
        "@context": "https://schema.org",
        "@type": "ImageGallery",
        "name": folder_name,
        "description": meta_description,
        "keywords": meta_keywords
    }

    if contents['images']:
        schema_data["image"] = [url_for('serveContent', filename=img['relativePathWithName']) for img in contents['images'][:5]]

    return {
        'folder_name': folder_name,
        'description': about_text,
        'keywords': metadata['keywords'][:10] if metadata['keywords'] else [],
        'breadcrumbs': metadata['breadcrumbs'],
        'page_title': page_title,
        'meta_description': meta_description,
        'meta_keywords': meta_keywords,
        'og_image': og_image,
        'og_type': "website",
        'schema_json': json.dumps(schema_data, indent=2)
    }

# ##########################################################
# Image processing functions
# ##########################################################
def getImageMetadata(imageFullPathWithName):
    # Get image metadata from sidecar XMP file first, then from embedded XMP
    # Image path is full disk path to image

    # Apple Metadata is even more unreliable than first thought.
    # The description in the image file might be absent when it's not.
    # But it also might be wrong. It might be a prior description or ??
    # So, we're always going to use sidecar, whose data is correct.
    #
    # First, try to find and read sidecar XMP file
    base_path = os.path.splitext(imageFullPathWithName)[0]
    sidecar_patterns = [
        f"{base_path}.xmp",
        f"{base_path}.XMP",
    ]

    for sidecar_path in sidecar_patterns:
        if os.path.exists(sidecar_path):
            try:
                with open(sidecar_path, 'r', encoding='utf-8') as f:
                    xmp_str = f.read()

                root = ET.fromstring(xmp_str)
                ns = {
                    'dc': 'http://purl.org/dc/elements/1.1/',
                    'rdf': 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'
                }

                def get_text(tag):
                    # First try direct text element
                    el = root.find(f'.//dc:{tag}', ns)
                    if el is not None and el.text:
                        return el.text.strip()

                    # Fall back to rdf:Alt/rdf:li structure
                    el = root.find(f'.//dc:{tag}/rdf:Alt/rdf:li', ns)
                    return el.text.strip() if el is not None and el.text else ""

                title = get_text('description')
                description = get_text('title')

                if title is None and description is None:
                    title = ''
                    fullTitle = ''
                else:
                    if title is None:
                        title = description
                    else:
                        fullTitle = title + ', on ' + description

                return {
                    'title': title,
                    'fullTitle': fullTitle
                }
            except Exception:
                continue

    # No sidecar file found, use ORIGINAL embedded XMP logic
    XMP_START = b'<x:xmpmeta'
    XMP_END = b'</x:xmpmeta>'
    try:
        with open(imageFullPathWithName, 'rb') as f:
            data = f.read()
        start = data.find(XMP_START)
        end = data.find(XMP_END)

        if start == -1 or end == -1:
            return {
                'title': '',
                'fullTitle': ''
            }

        xmp_bytes = data[start:end+len(XMP_END)]
        try:
            xmp_str = xmp_bytes.decode('utf-8', errors='ignore')
            root = ET.fromstring(xmp_str)
        except Exception:
            return {
                'title': '',
                'fullTitle': ''
            }

        ns = {
            'dc': 'http://purl.org/dc/elements/1.1/',
            'rdf': 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'
        }

        def get_text(tag):
            el = root.find(f'.//dc:{tag}/rdf:Alt/rdf:li', ns)
            return el.text.strip() if el is not None and el.text else ""

        title = get_text('description')
        description = get_text('title')
        if title is None and description is None:
            title = ''
            fullTitle = ''
        else:
            if title is None:
                title = description
            else:
                fullTitle = title + ', on ' + description

        return {
            'title': title,
            'fullTitle': fullTitle
        }
    except Exception as e:
        return {
            'title': '',
            'fullTitle': ''
        }

def getRandomImage(folderPath):
    # Get a random image from a folder to use as folder thumbnail
    images = []

    # First check current directory
    for item in os.listdir(folderPath):
        itemFullPathWithName = os.path.join(folderPath, item)
        if os.path.isfile(itemFullPathWithName) and isImage(item):
            images.append(os.path.join(os.path.relpath(folderPath, app.config['CONTENT_FOLDER']), item))

    # If no images in current directory, search subdirectories recursively
    if not images:
        for root, dirs, files in os.walk(folderPath):
            for file in files:
                if isImage(file):
                    relPath = os.path.relpath(os.path.join(root, file), app.config['CONTENT_FOLDER'])
                    images.append(relPath)
                    break  # Found one image, no need to continue in this subdirectory
            if images:
                break  # Found at least one image, no need to search further

    # If still no images found, return a default folder icon
    if not images:
        return "/static/img/folder-icon.png"

    # Return a random image from the list
    return random.choice(images)

def isImage(filename):
    # Check if a file is an image based on extension
    image_extensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.mov']
    _, ext = os.path.splitext(filename.lower())
    return ext in image_extensions

# ##########################################################
# Path processing functions
# ##########################################################
def buildBreadcrumbs(path):
    # Generate breadcrumbs for backwards navigation
    parts = path.split('/')
    breadcrumbs = [{'name': 'Home', 'path': ''}]

    currentPath = ""
    for part in parts:
        if part:  # Skip empty parts
            currentPath = os.path.join(currentPath, part)
            breadcrumbs.append({
                'name': part,
                'path': currentPath
            })

    return breadcrumbs

def getFolderContents(itemRelativePath):
    # Get contents of a folder
    itemFullPath = os.path.join(app.config['CONTENT_FOLDER'], itemRelativePath)          # Full path of Folder

    # Check if path exists and is a directory
    if not os.path.exists(itemFullPath) or not os.path.isdir(itemFullPath):
        return None

    contents = {
        'folders': [],
        'images': []
    }

    # Get all items in the directory
    items = os.listdir(itemFullPath)                                        # Items may contain folders and images

    for item in items:
        itemFullPathWithName = os.path.join(itemFullPath, item)
        # Skip about.txt and keywords.txt
        if item in ['about.txt', 'keywords.txt']:
            continue

        if os.path.isdir(itemFullPathWithName):
            # This is a subfolder
            thumbnail = getRandomImage(itemFullPathWithName)
            contents['folders'].append({
                'name': item,
                'path': os.path.join(itemRelativePath, item),
                'thumbnail': thumbnail
            })
        elif isImage(item):
            # This is an image
            # Relative path is the path relative to the content folder

            metadata = getImageMetadata(itemFullPathWithName)               # Image Full Path (with name)
            # item:                 Nord.png
            # relativePath:         Nord
            # relativePathWithName: Nord/Nord.png
            # itemFullPath:         /Users/me/current/content/Nord
            # itemFullPathWithName: /Users/me/current/content/Nord/Nord.png
            contents['images'].append({
                'name': item,                                               # Image Name (only)
                'relativePath': itemRelativePath,                           # Relative (not full) path (without name)
                'relativePathWithName': "/".join([itemRelativePath, item]) if itemRelativePath else item, # Relative (not full) path with name
                'fullPathWithName': itemFullPathWithName,                   # Full path with name
                'metadata': metadata                                        # Contains Title and Description
            })

    # Sort folders and images alphabetically by name
    contents['folders'].sort(key=lambda x: x['name'].lower())
    contents['images'].sort(key=lambda x: x['name'].lower())

    return contents

# ##########################################################
# Path processing application routes
# ##########################################################
@app.route('/')
def home():
    # Render the home page
    contents = getFolderContents('')
    page_meta = build_page_metadata('', contents)

    return render_template('index.html',
                          contents=contents,
                          currentPath='',
                          **page_meta)

@app.route('/folder/<path:folderPath>')
def folder(folderPath):
    # Setup a folder of images
    contents = getFolderContents(folderPath)
    if contents is None:
        return "Folder not found", 404

    page_meta = build_page_metadata(folderPath, contents)

    return render_template('index.html',
                          contents=contents,
                          currentPath=folderPath,
                          **page_meta)

# For any content file
@app.route('/content/<path:filename>')
def serveContent(filename):
    # Serve files from the content directory
    return send_from_directory(app.config['CONTENT_FOLDER'], filename)

# ##########################################################
# Comments processing application routes and functions
# ##########################################################
@app.route('/comments/<path:imageName>')
def getComments(imageName):
    # Get comments for an image (AJAX endpoint)
    # Decode URL encoding to handle special characters
    imageName = unquote(imageName)
    try:
        conn = getDataDB()
        cur = conn.cursor()
        cur.execute("""
            SELECT imageName, author, comment, created
            FROM comments
            WHERE imageName = ?
            ORDER BY created DESC
        """, (imageName,))
        comments = [dict(row) for row in cur.fetchall()]
        return jsonify({'comments': comments})
    except Exception as e:
        logger.error(f"[ERROR] getComments failed: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/comments', methods=['POST'])
def postComment():
    # Post a comment for an image (AJAX endpoint)
    try:
        imageName = request.form['imageName']
        author = request.form['author']
        comment = request.form['comment']

        conn = getDataDB()
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO comments (imageName, author, comment)
            VALUES (?, ?, ?)
        """, (imageName, author, comment))
        conn.commit()
        conn.close()

        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"Error inserting comment: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/comments/modal/<path:imageName>')
def getCommentsModal(imageName):
    # Server-side rendered comments modal
    # Decode URL encoding to handle special characters
    imageName = unquote(imageName)
    imageTitle = request.args.get('title', imageName)

    try:
        conn = getDataDB()
        cur = conn.cursor()
        cur.execute("""
            SELECT imageName, author, comment, created
            FROM comments
            WHERE imageName = ?
            ORDER BY created DESC
        """, (imageName,))
        comments = [dict(row) for row in cur.fetchall()]
        conn.close()

        return render_template('comments.html',
                             comments=comments,
                             imageName=imageName,
                             imageTitle=imageTitle)
    except Exception as e:
        logger.error(f"[ERROR] getCommentsModal failed: {str(e)}")
        return render_template('comments.html',
                             comments=[],
                             imageName=imageName,
                             imageTitle=imageTitle,
                             error=str(e))

@app.route('/comments/add', methods=['POST'])
def addCommentServer():
    # Server-side comment addition with redirect back to modal
    try:
        imageName = request.form['imageName']
        author = request.form['author']
        comment = request.form['comment']
        imageTitle = request.form.get('imageTitle', imageName)

        conn = getDataDB()
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO comments (imageName, author, comment)
            VALUES (?, ?, ?)
        """, (imageName, author, comment))
        conn.commit()
        conn.close()

        # Redirect back to the modal with success message
        return redirect(url_for('getCommentsModal',
                              imageName=imageName,
                              title=imageTitle,
                              success='Comment added successfully'))
    except Exception as e:
        logger.error(f"Error inserting comment: {str(e)}")
        # Redirect back with error message
        return redirect(url_for('getCommentsModal',
                              imageName=request.form.get('imageName', ''),
                              title=request.form.get('imageTitle', ''),
                              error=str(e)))

# ##########################################################
# Blog processing application routes and functions
# ##########################################################
@app.route('/blog')
@app.route('/blog/<int:page>')
def blog(page=1):
    per_page = postsPerPage
    search_query = request.args.get('search', '').strip()
    category_filter = request.args.get('category', '')
    province_filter = request.args.get('province', '')
    city_filter = request.args.get('city', '')
    author_filter = request.args.get('author', '')
    sort_by = request.args.get('sort', 'date_desc')

    # Check if this is an AJAX request
    is_ajax = request.headers.get('X-Requested-With') == 'XMLHttpRequest'

    try:
        conn = getDataDB()
        cursor = conn.cursor()

        # Test basic query first
        cursor.execute("SELECT * FROM blogs LIMIT 1")

        # Fetch filter options with counts for better UX
        cursor.execute("""
            SELECT category, COUNT(*) as count
            FROM blogs
            WHERE category IS NOT NULL
            GROUP BY category
            ORDER BY category
        """)
        categories = [{'name': row['category'], 'count': row['count']} for row in cursor.fetchall()]

        cursor.execute("""
            SELECT province, COUNT(*) as count
            FROM blogs
            WHERE province IS NOT NULL
            GROUP BY province
            ORDER BY province
        """)
        provinces = [{'name': row['province'], 'count': row['count']} for row in cursor.fetchall()]

        cursor.execute("""
            SELECT city, COUNT(*) as count
            FROM blogs
            WHERE city IS NOT NULL
            GROUP BY city
            ORDER BY city
        """)
        cities = [{'name': row['city'], 'count': row['count']} for row in cursor.fetchall()]

        cursor.execute("""
            SELECT author, COUNT(*) as count
            FROM blogs
            WHERE author IS NOT NULL
            GROUP BY author
            ORDER BY author
        """)
        authors = [{'name': row['author'], 'count': row['count']} for row in cursor.fetchall()]

        # Build dynamic query with better search functionality
        query = "SELECT * FROM blogs WHERE 1=1"
        params = []

        if search_query:
            # Enhanced search with ranking
            query += " AND (title LIKE ? OR content LIKE ? OR excerpt LIKE ? OR author LIKE ?)"
            search_term = f'%{search_query}%'
            params.extend([search_term, search_term, search_term, search_term])

        if category_filter:
            query += " AND category = ?"
            params.append(category_filter)
        if province_filter:
            query += " AND province = ?"
            params.append(province_filter)
        if city_filter:
            query += " AND city = ?"
            params.append(city_filter)
        if author_filter:
            query += " AND author = ?"
            params.append(author_filter)

        # Apply sorting with more options
        sort_options = {
            'title_asc': 'title ASC',
            'title_desc': 'title DESC',
            'date_asc': 'date ASC',
            'date_desc': 'date DESC',
            'author_asc': 'author ASC',
            'author_desc': 'author DESC'
        }
        query += f" ORDER BY {sort_options.get(sort_by, 'date DESC')}"

        # Count total posts
        count_query = query.replace("SELECT *", "SELECT COUNT(*)")
        cursor.execute(count_query, params)
        total_posts = cursor.fetchone()[0]

        # Fetch paginated posts
        query += " LIMIT ? OFFSET ?"
        params.extend([per_page, (page - 1) * per_page])
        cursor.execute(query, params)
        posts = [dict(row) for row in cursor.fetchall()]

        # Process posts for display with better image handling
        processed_posts = []
        for post in posts:
            # Ensure image URLs are absolute with fallback
            image_url = post.get('image', '/static/img/placeholder.jpg')
            if image_url and not image_url.startswith('/') and not image_url.startswith('http'):
                image_url = '/' + image_url

            # Better excerpt generation
            excerpt = post.get('excerpt', '')
            if not excerpt and post.get('content'):
                # Create excerpt from content, preserving word boundaries
                content_text = re.sub(r'<[^>]+>', '', post['content'])  # Strip HTML
                if len(content_text) > 200:
                    excerpt = content_text[:197] + "..."
                else:
                    excerpt = content_text

            processed_posts.append({
                'id': post['id'],
                'title': post['title'],
                'author': post.get('author', 'Unknown'),
                'date': post['date'],
                'excerpt': excerpt,
                'image': image_url,
                'category': post.get('category', ''),
                'province': post.get('province', ''),
                'city': post.get('city', '')
            })

        total_pages = (total_posts + per_page - 1) // per_page

        # Generate pagination data
        pagination_data = generate_pagination_data(page, total_pages)

        # Prepare filter data
        filter_data = {
            'search_query': search_query,
            'category_filter': category_filter,
            'province_filter': province_filter,
            'city_filter': city_filter,
            'author_filter': author_filter,
            'sort_by': sort_by
        }

        # Build comprehensive metadata
        metadata = build_blog_metadata(
            processed_posts,
            search_query,
            category_filter,
            province_filter,
            city_filter,
            author_filter
        )

        # Return JSON for AJAX requests
        if is_ajax:
            return jsonify({
                'success': True,
                'posts': processed_posts,
                'pagination': pagination_data,
                'total_posts': total_posts,
                'page': page,
                'total_pages': total_pages,
                'filters': filter_data,
                'metadata': metadata
            })

        # Regular template response
        response = render_template('blog.html',
                                 posts=processed_posts,
                                 page=page,
                                 total_pages=total_pages,
                                 pagination=pagination_data,
                                 categories=categories,
                                 provinces=provinces,
                                 cities=cities,
                                 authors=authors,
                                 total_posts=total_posts,
                                 **filter_data,
                                 **metadata)

        response = Response(response)
        response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
        return response

    except Exception as e:
        logger.error(f"Error fetching blog posts: {str(e)}")

        error_data = {
            'posts': [],
            'page': 1,
            'total_pages': 1,
            'pagination': {'pages': [], 'show_prev': False, 'show_next': False},
            'categories': [],
            'provinces': [],
            'cities': [],
            'authors': [],
            'total_posts': 0,
            'search_query': '',
            'category_filter': '',
            'province_filter': '',
            'city_filter': '',
            'author_filter': '',
            'sort_by': 'date_desc'
        }

        # Add error metadata
        error_metadata = build_blog_metadata([])
        error_metadata['page_title'] = f"Error - {appTitle}"
        error_metadata['meta_description'] = "An error occurred while loading blog posts."

        if is_ajax:
            return jsonify({
                'success': False,
                'error': 'Error loading blog posts. Please try again.',
                **error_data,
                'metadata': error_metadata
            }), 500

        flash("Error loading blog posts. Please try again.", "error")
        return render_template('blog.html', **error_data, **error_metadata)

@app.route('/blog/post/<int:post_id>')
def blog_post_detail(post_id):
    """Get individual post details with enhanced error handling and metadata"""
    try:
        conn = getDataDB()
        cur = conn.cursor()
        row = cur.execute("SELECT * FROM blogs WHERE id = ?", (post_id,)).fetchone()

        if not row:
            return jsonify({"success": False, "error": "Post not found"}), 404

        post = dict(row)

        # Enhanced image URL handling
        image_url = post.get("image", "/static/img/placeholder.jpg")
        if image_url and not image_url.startswith('/') and not image_url.startswith('http'):
            image_url = '/' + image_url

        # Build post data for the JavaScript
        post_data = {
            'id': post['id'],
            'title': post["title"],
            'slug': post.get("slug", post['id']),
            'image_url': image_url,
            'content': post["content"],
            'author': post.get("author", "Unknown"),
            'date': post["date"],
            'modified_date': post.get("modified_date", post["date"]),
            'category': post.get("category", ""),
            'province': post.get("province", ""),
            'city': post.get("city", ""),
            'excerpt': post.get("excerpt", ""),
            'next_post_slug': post.get("next_post_slug"),
            'prev_post_slug': post.get("prev_post_slug")
        }

        # Build metadata (keep your existing function)
        metadata = build_blog_post_metadata(post_data)

        # Return both post data and metadata
        return jsonify({
            "success": True,
            **post_data,  # Flatten post data to root level
            "metadata": metadata  # Keep metadata separate
        })

    except Exception as e:
        logger.error(f"Error fetching blog post {post_id}: {str(e)}")
        return jsonify({"success": False, "error": "Error loading post"}), 500

@app.route('/blog/filters')
def blog_filters():
    """API endpoint to get filter options (for dynamic loading)"""
    try:
        conn = getDataDB()
        cursor = conn.cursor()

        # Get all filter options
        cursor.execute("SELECT DISTINCT category FROM blogs WHERE category IS NOT NULL ORDER BY category")
        categories = [row['category'] for row in cursor.fetchall()]

        cursor.execute("SELECT DISTINCT province FROM blogs WHERE province IS NOT NULL ORDER BY province")
        provinces = [row['province'] for row in cursor.fetchall()]

        cursor.execute("SELECT DISTINCT city FROM blogs WHERE city IS NOT NULL ORDER BY city")
        cities = [row['city'] for row in cursor.fetchall()]

        cursor.execute("SELECT DISTINCT author FROM blogs WHERE author IS NOT NULL ORDER BY author")
        authors = [row['author'] for row in cursor.fetchall()]

        return jsonify({
            'success': True,
            'categories': categories,
            'provinces': provinces,
            'cities': cities,
            'authors': authors
        })
    except Exception as e:
        logger.error(f"Error fetching filter options: {str(e)}")
        return jsonify({'success': False, 'error': 'Error loading filters'}), 500

# For blog image
@app.route('/data/images/<path:filename>')
def serveDataImages(filename):
    try:
        # Normalize path to prevent directory traversal
        filename = os.path.normpath(filename)
        if filename.startswith('..') or os.path.isabs(filename):
            logger.error(f"Invalid path attempted: {filename}")
            raise ValueError("Invalid file path")
        # Try exact match first
        full_path = os.path.join(app.config['IMAGES_FOLDER'], filename)
        if os.path.exists(full_path) and os.path.isfile(full_path):
            response = send_from_directory(app.config['IMAGES_FOLDER'], filename)
            response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
            return response
        # Try case-insensitive match
        base_dir = app.config['IMAGES_FOLDER']
        for root, _, files in os.walk(base_dir):
            for f in files:
                if f.lower() == filename.lower():
                    rel_path = os.path.relpath(os.path.join(root, f), base_dir)
                    response = send_from_directory(base_dir, rel_path)
                    response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
                    return response
        raise FileNotFoundError(f"File {filename} not found")
    except Exception as e:
        return "Image not found", 404

# For fallback
@app.route('/blog/<slug>')
def blog_post(slug):
    post = get_post_by_slug(slug)

    # Check if this is an AJAX request
    if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
        # Return JSON for the drawer
        return jsonify(post.to_dict())
    else:
        # Return full HTML page
        return render_template('blog_post.html', post=post)

def build_blog_metadata(posts, search_query='', category_filter='', province_filter='', city_filter='', author_filter=''):
    """Build comprehensive metadata for blog pages"""

    # Base metadata
    page_title = appTitle
    meta_description = f"Explore our collection of blog posts covering various topics and locations."
    meta_keywords = []
    og_image = '/static/img/blog-default.jpg'  # Default blog image

    # Build dynamic title and description based on filters
    title_parts = []
    description_parts = []

    if search_query:
        title_parts.append(f'Search: "{search_query}"')
        description_parts.append(f'posts matching "{search_query}"')
        meta_keywords.extend(search_query.split())

    if category_filter:
        title_parts.append(f'Category: {category_filter}')
        description_parts.append(f'{category_filter} posts')
        meta_keywords.append(category_filter.lower())

    if province_filter:
        title_parts.append(f'Province: {province_filter}')
        description_parts.append(f'posts from {province_filter}')
        meta_keywords.append(province_filter.lower())

    if city_filter:
        title_parts.append(f'City: {city_filter}')
        description_parts.append(f'posts from {city_filter}')
        meta_keywords.append(city_filter.lower())

    if author_filter:
        title_parts.append(f'Author: {author_filter}')
        description_parts.append(f'posts by {author_filter}')
        meta_keywords.append(author_filter.lower())

    # Construct final title and description
    if title_parts:
        page_title = f"{' | '.join(title_parts)} - {appTitle}"
        meta_description = f"Browse {' and '.join(description_parts)} on {appTitle}."

    # Use first post's image as OG image if available
    if posts and posts[0].get('image') and not posts[0]['image'].startswith('/static/'):
        og_image = posts[0]['image']

    # Extract additional keywords from post titles and categories
    if posts:
        for post in posts[:5]:  # Limit to first 5 posts for performance
            if post.get('title'):
                # Add significant words from titles (excluding common words)
                title_words = [word.lower() for word in post['title'].split()
                             if len(word) > 3 and word.lower() not in ['with', 'that', 'this', 'from', 'they', 'have', 'been', 'were', 'said']]
                meta_keywords.extend(title_words[:3])  # Max 3 words per title

            if post.get('category') and post['category'].lower() not in meta_keywords:
                meta_keywords.append(post['category'].lower())

    # Remove duplicates and limit keywords
    meta_keywords = list(dict.fromkeys(meta_keywords))[:15]  # Max 15 keywords

    # Build breadcrumbs for blog
    breadcrumbs = [{'name': 'Home', 'path': '/'}]

    if any([search_query, category_filter, province_filter, city_filter, author_filter]):
        breadcrumbs.append({'name': 'Blog', 'path': '/blog'})

        if category_filter:
            breadcrumbs.append({'name': category_filter, 'path': f'/blog?category={category_filter}'})
        if province_filter:
            breadcrumbs.append({'name': province_filter, 'path': f'/blog?province={province_filter}'})
        if city_filter:
            breadcrumbs.append({'name': city_filter, 'path': f'/blog?city={city_filter}'})
        if author_filter:
            breadcrumbs.append({'name': author_filter, 'path': f'/blog?author={author_filter}'})
    else:
        breadcrumbs.append({'name': 'Blog', 'path': '/blog'})

    # Build Schema.org structured data
    schema_data = {
        "@context": "https://schema.org",
        "@type": "Blog",
        "name": f"{appTitle} Blog",
        "description": meta_description,
        "url": request.url,
        "keywords": ', '.join(meta_keywords)
    }

    # Add blog posts to schema if available
    if posts:
        blog_posts = []
        for post in posts[:10]:  # Limit to first 10 posts
            post_schema = {
                "@type": "BlogPosting",
                "headline": post.get('title', 'Untitled'),
                "description": post.get('excerpt', ''),
                "datePublished": post.get('date', ''),
                "author": {
                    "@type": "Person",
                    "name": post.get('author', 'Unknown')
                }
            }

            if post.get('image'):
                post_schema["image"] = post['image']

            if post.get('category'):
                post_schema["keywords"] = post['category']

            blog_posts.append(post_schema)

        schema_data["blogPost"] = blog_posts

    return {
        'page_title': page_title,
        'meta_description': meta_description,
        'meta_keywords': ', '.join(meta_keywords),
        'og_image': og_image,
        'og_type': 'website',
        'breadcrumbs': breadcrumbs,
        'schema_json': json.dumps(schema_data, indent=2)
    }

def build_blog_post_metadata(post):
    """Build metadata for individual blog post"""

    page_title = f"{post.get('title', 'Untitled')} - {appTitle}"
    meta_description = post.get('excerpt', '')

    # If no excerpt, create one from content
    if not meta_description and post.get('content'):
        content_text = re.sub(r'<[^>]+>', '', post['content'])  # Strip HTML
        meta_description = content_text[:160] if len(content_text) > 160 else content_text

    # Build keywords from title, category, location
    meta_keywords = []

    if post.get('title'):
        title_words = [word.lower() for word in post['title'].split()
                      if len(word) > 3 and word.lower() not in ['with', 'that', 'this', 'from', 'they', 'have', 'been', 'were', 'said']]
        meta_keywords.extend(title_words[:5])

    if post.get('category'):
        meta_keywords.append(post['category'].lower())

    if post.get('province'):
        meta_keywords.append(post['province'].lower())

    if post.get('city'):
        meta_keywords.append(post['city'].lower())

    if post.get('author'):
        meta_keywords.extend(post['author'].lower().split()[:2])  # Author name parts

    # Remove duplicates
    meta_keywords = list(dict.fromkeys(meta_keywords))[:10]

    # OG image
    og_image = post.get('image', '/static/img/blog-default.jpg')

    # Build breadcrumbs
    breadcrumbs = [
        {'name': 'Home', 'path': '/'},
        {'name': 'Blog', 'path': '/blog'},
        {'name': post.get('title', 'Post'), 'path': f"/blog/post/{post.get('id', '')}"}
    ]

    # Schema.org structured data for blog post
    schema_data = {
        "@context": "https://schema.org",
        "@type": "BlogPosting",
        "headline": post.get('title', 'Untitled'),
        "description": meta_description,
        "datePublished": post.get('date', ''),
        "author": {
            "@type": "Person",
            "name": post.get('author', 'Unknown')
        },
        "publisher": {
            "@type": "Organization",
            "name": appTitle
        }
    }

    if post.get('image'):
        schema_data["image"] = {
            "@type": "ImageObject",
            "url": post['image']
        }

    if post.get('category'):
        schema_data["keywords"] = post['category']

    if post.get('province') or post.get('city'):
        location_parts = [part for part in [post.get('city'), post.get('province')] if part]
        schema_data["locationCreated"] = {
            "@type": "Place",
            "name": ', '.join(location_parts)
        }

    return {
        'page_title': page_title,
        'meta_description': meta_description,
        'meta_keywords': ', '.join(meta_keywords),
        'og_image': og_image,
        'og_type': 'article',
        'breadcrumbs': breadcrumbs,
        'schema_json': json.dumps(schema_data, indent=2)
    }

def generate_pagination_data(current_page, total_pages):
    """Generate pagination data for template rendering with improved logic"""
    if total_pages <= 1:
        return {'pages': [], 'show_prev': False, 'show_next': False}

    max_pages_to_show = 10

    # Calculate start and end pages
    if total_pages <= max_pages_to_show:
        start_page = 1
        end_page = total_pages
    else:
        # Center the current page
        start_page = max(1, current_page - max_pages_to_show // 2)
        end_page = min(total_pages, start_page + max_pages_to_show - 1)

        # Adjust if we're too close to the end
        if end_page == total_pages:
            start_page = max(1, end_page - max_pages_to_show + 1)

    pages = []

    # Add first page and ellipsis if needed
    if start_page > 1:
        pages.append({
            'number': 1,
            'is_current': False,
            'url': url_for('blog', page=1, **{k: v for k, v in request.args.items() if k != 'page'})
        })
        if start_page > 2:
            pages.append({'ellipsis': True})

    # Add page numbers
    for i in range(start_page, end_page + 1):
        pages.append({
            'number': i,
            'is_current': i == current_page,
            'url': url_for('blog', page=i, **{k: v for k, v in request.args.items() if k != 'page'})
        })

    # Add last page and ellipsis if needed
    if end_page < total_pages:
        if end_page < total_pages - 1:
            pages.append({'ellipsis': True})
        pages.append({
            'number': total_pages,
            'is_current': False,
            'url': url_for('blog', page=total_pages, **{k: v for k, v in request.args.items() if k != 'page'})
        })

    return {
        'pages': pages,
        'show_prev': current_page > 1,
        'show_next': current_page < total_pages,
        'prev_url': url_for('blog', page=current_page - 1, **{k: v for k, v in request.args.items() if k != 'page'}) if current_page > 1 else None,
        'next_url': url_for('blog', page=current_page + 1, **{k: v for k, v in request.args.items() if k != 'page'}) if current_page < total_pages else None
    }

# ##########################################################
# Admin routes
# ##########################################################
@app.route('/admin')
@auth.login_required
def admin():
    try:
        conn = getDataDB()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM blogs ORDER BY date DESC")
        posts = [dict(row) for row in cursor.fetchall()]
        return render_template('admin.html', posts=posts)
    except Exception as e:
        logger.error(f"Error fetching admin posts: {str(e)}")
        flash("Error loading posts. Please try again.", "error")
        return render_template('admin.html', posts=[])

@app.route('/admin/add', methods=['GET', 'POST'])
@auth.login_required
def add_post():
    if request.method == 'POST':
        try:
            title = sanitizeInput(request.form['title'])
            date = request.form['date']
            author = sanitizeInput(request.form['author'])
            category = sanitizeInput(request.form['category'])
            province = sanitizeInput(request.form['province']) or None
            city = sanitizeInput(request.form['city']) or None
            image = sanitizeInput(request.form['image']) or None
            excerpt = sanitizeInput(request.form['excerpt'])
            content = request.form['content']
            if not all([title, date, author, category, excerpt, content]):
                flash("All required fields must be filled.", "error")
                return render_template('add_post.html')
            conn = getDataDB()
            cursor = conn.cursor()
            cursor.execute('''
                INSERT INTO blogs (title, date, author, category, province, city, image, excerpt, content)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (title, date, author, category, province, city, image, excerpt, content))
            conn.commit()
            flash("Post added successfully!", "success")
            return redirect(url_for('admin'))
        except Exception as e:
            logger.error(f"Error adding post: {str(e)}")
            flash("Error adding post. Please try again.", "error")
            return render_template('add_post.html')
    return render_template('add_post.html')

@app.route('/admin/edit/<int:id>', methods=['GET', 'POST'])
@auth.login_required
def edit_post(id):
    conn = getDataDB()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM blogs WHERE id = ?", (id,))
    post = cursor.fetchone()
    if not post:
        flash("Post not found.", "error")
        return redirect(url_for('admin'))
    post = dict(post)
    if request.method == 'POST':
        try:
            title = sanitizeInput(request.form['title'])
            date = request.form['date']
            author = sanitizeInput(request.form['author'])
            category = sanitizeInput(request.form['category'])
            province = sanitizeInput(request.form['province']) or None
            city = sanitizeInput(request.form['city']) or None
            image = sanitizeInput(request.form['image']) or None
            excerpt = sanitizeInput(request.form['excerpt'])
            content = request.form['content']
            if not all([title, date, author, category, excerpt, content]):
                flash("All required fields must be filled.", "error")
                return render_template('edit_post.html', post=post)
            cursor.execute('''
                UPDATE blogs SET title = ?, date = ?, author = ?, category = ?, province = ?, city = ?, image = ?, excerpt = ?, content = ?
                WHERE id = ?
            ''', (title, date, author, category, province, city, image, excerpt, content, id))
            conn.commit()
            flash("Post updated successfully!", "success")
            return redirect(url_for('admin'))
        except Exception as e:
            logger.error(f"Error updating post: {str(e)}")
            flash("Error updating post. Please try again.", "error")
            return render_template('edit_post.html', post=post)
    return render_template('edit_post.html', post=post)

@app.route('/admin/delete/<int:id>', methods=['POST'])
@auth.login_required
def delete_post(id):
    try:
        conn = getDataDB()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM blogs WHERE id = ?", (id,))
        conn.commit()
        flash("Post deleted successfully!", "success")
    except Exception as e:
        logger.error(f"Error deleting post: {str(e)}")
        flash("Error deleting post. Please try again.", "error")
    return redirect(url_for('admin'))

if __name__ == '__main__':
    app.run(debug=True)

