/* static/js/main.js */
let currentImageIndex = 0;
let imagesInFolder = [];
let commentsWindow = null;

document.addEventListener('DOMContentLoaded', () => {
    // Initialize the gallery when DOM is ready
    new PhotoGallery();

    // Set up an image folder
    document.querySelectorAll('.folder-item').forEach(folder => {
        folder.addEventListener('click', function() {
            const folderPath = this.getAttribute('data-path');
            window.location.href = `/folder/${folderPath}`;
        });
    });

    // Only set up modal close if modal exists
    const modalClose = document.querySelector('.modal .close');
    if (modalClose) {
        modalClose.addEventListener('click', () => {
            closeCommentsWindow();
            const imageModal = document.getElementById('imageModal');
            if (imageModal) {
                imageModal.style.display = 'none';
            }
        });
    }

    // Modal close on background click
    window.addEventListener('click', function(event) {
        const modal = document.getElementById('imageModal');
        if (modal && event.target === modal) {
            modal.style.display = 'none';
            closeCommentsWindow();
        }
    });

    // Close comments window when main modal closes
    window.addEventListener('beforeunload', function() {
        closeCommentsWindow();
    });
});

// Privacy Popup
let popupLoaded = false;

document.addEventListener('DOMContentLoaded', () => {
    const link = document.getElementById('privacyLink');

    function showPopup() {
        const popup = document.getElementById('privacyPopup');
        const blur = document.getElementById('blurOverlay');

        popup.classList.add('visible');
        blur.style.display = 'block';
        document.body.classList.add('popup-open'); // Prevent body shift
    }

    function hidePopup() {
        const popup = document.getElementById('privacyPopup');
        const blur = document.getElementById('blurOverlay');

        popup.classList.remove('visible');
        blur.style.display = 'none';
        document.body.classList.remove('popup-open'); // Restore body
    }

    if (link) {
        link.addEventListener('click', function(event) {
            event.stopPropagation();

            if (!popupLoaded) {
                fetch('/privacy')
                    .then(res => res.text())
                    .then(html => {
                        document.body.insertAdjacentHTML('beforeend', html);
                        popupLoaded = true;

                        showPopup();

                        // Add click outside listener
                        document.addEventListener('click', function clickOutsideHandler(event) {
                            const popup = document.getElementById('privacyPopup');
                            if (!popup.contains(event.target) && event.target !== link) {
                                hidePopup();
                            }
                        });
                    })
                    .catch(err => console.error('Failed to load popup:', err));
            } else {
                showPopup();
            }
        });
    }
});

// Utility
var gk_isXlsx = false;
var gk_xlsxFileLookup = {};
var gk_fileData = {};

function filledCell(cell) {
    return cell !== '' && cell != null;
}
function loadFileData(filename) {
    if (gk_isXlsx && gk_xlsxFileLookup[filename]) {
        try {
            var workbook = XLSX.read(gk_fileData[filename], { type: 'base64' });
            var firstSheetName = workbook.SheetNames[0];
            var worksheet = workbook.Sheets[firstSheetName];

            // Convert sheet to JSON to filter blank rows
            var jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, blankrows: false, defval: '' });
            // Filter out blank rows (rows where all cells are empty, null, or undefined)
            var filteredData = jsonData.filter(row => row.some(filledCell));

            // Heuristic to find the header row by ignoring rows with fewer filled cells than the next row
            var headerRowIndex = filteredData.findIndex((row, index) =>
              row.filter(filledCell).length >= filteredData[index + 1]?.filter(filledCell).length
            );
            // Fallback
            if (headerRowIndex === -1 || headerRowIndex > 25) {
              headerRowIndex = 0;
            }

            // Convert filtered JSON back to CSV
            // Create a new sheet from filtered array of arrays
            var csv = XLSX.utils.aoa_to_sheet(filteredData.slice(headerRowIndex));
            csv = XLSX.utils.sheet_to_csv(csv, { header: 1 });
            return csv;
        } catch (e) {
            console.error(e);
            return "";
        }
    }
    return gk_fileData[filename] || "";
}

// Accordion columns
class ResizableAccordion {
    constructor(container) {
        this.container = container;

        // Add null check to prevent errors
        if (!this.container) {
            console.warn('ResizableAccordion: Container element not found');
            return;
        }

        this.isResizing = false;
        this.currentHandle = null;
        this.columns = null;
        this.startX = 0;
        this.startY = 0;
        this.startWidths = [];
        this.startHeights = [];
        this.isMobile = window.innerWidth <= 768;

        this.init();
    }

    init() {
        // Only initialize if container exists
        if (!this.container) return;

        this.bindEvents();
        this.handleResize();
    }

    bindEvents() {
        // Only bind events if container exists
        if (!this.container) return;

        // Handle mouse events
        this.container.addEventListener('mousedown', this.handleMouseDown.bind(this));
        document.addEventListener('mousemove', this.handleMouseMove.bind(this));
        document.addEventListener('mouseup', this.handleMouseUp.bind(this));

        // Handle touch events for mobile
        this.container.addEventListener('touchstart', this.handleTouchStart.bind(this), { passive: false });
        document.addEventListener('touchmove', this.handleTouchMove.bind(this), { passive: false });
        document.addEventListener('touchend', this.handleTouchEnd.bind(this));

        // Handle window resize
        window.addEventListener('resize', this.handleResize.bind(this));
    }

    handleResize() {
        const wasMobile = this.isMobile;
        this.isMobile = window.innerWidth <= 768;

        // Reset flex properties when switching between mobile/desktop
        if (wasMobile !== this.isMobile) {
            const aboutColumn = document.getElementById('aboutColumn');
            const galleryColumn = document.getElementById('galleryColumn');

            if (aboutColumn && galleryColumn) {
                if (this.isMobile) {
                    aboutColumn.style.flex = '0 0 200px';
                    galleryColumn.style.flex = '1';
                } else {
                    aboutColumn.style.flex = '0 0 350px';
                    galleryColumn.style.flex = '1';
                }
            }
        }
    }

    handleMouseDown(e) {
        if (e.target.classList.contains('resize-handle')) {
            this.startResize(e, e.clientX, e.clientY);
        }
    }

    handleTouchStart(e) {
        if (e.target.classList.contains('resize-handle')) {
            e.preventDefault();
            const touch = e.touches[0];
            this.startResize(e, touch.clientX, touch.clientY);
        }
    }

    startResize(e, clientX, clientY) {
        this.isResizing = true;
        this.currentHandle = e.target;
        this.startX = clientX;
        this.startY = clientY;

        // Get the columns to resize
        const columnIds = this.currentHandle.dataset.resize.split(',');
        this.columns = columnIds.map(id => document.getElementById(id));

        // Store starting dimensions
        if (this.isMobile) {
            this.startHeights = this.columns.map(column => column.offsetHeight);
        } else {
            this.startWidths = this.columns.map(column => column.offsetWidth);
        }

        // Add resizing class
        this.container.classList.add('resizing');

        // Prevent text selection
        document.body.style.userSelect = 'none';
    }

    handleMouseMove(e) {
        if (this.isResizing) {
            this.performResize(e.clientX, e.clientY);
        }
    }

    handleTouchMove(e) {
        if (this.isResizing) {
            e.preventDefault();
            const touch = e.touches[0];
            this.performResize(touch.clientX, touch.clientY);
        }
    }

    performResize(clientX, clientY) {
        if (this.isMobile) {
            // Vertical resizing on mobile
            const deltaY = clientY - this.startY;
            const newHeight1 = Math.max(80, this.startHeights[0] + deltaY);
            const newHeight2 = Math.max(200, this.startHeights[1] - deltaY);

            if (this.columns[0] && this.columns[1]) {
                this.columns[0].style.flex = `0 0 ${newHeight1}px`;
                this.columns[1].style.flex = `0 0 ${newHeight2}px`;
            }
        } else {
            // Horizontal resizing on desktop - drag left/right to adjust column widths
            const deltaX = clientX - this.startX;
            const newWidth1 = Math.max(150, this.startWidths[0] + deltaX);
            const newWidth2 = Math.max(300, this.startWidths[1] - deltaX);

            if (this.columns[0] && this.columns[1]) {
                this.columns[0].style.flex = `0 0 ${newWidth1}px`;
                this.columns[1].style.flex = `1 1 ${newWidth2}px`;
            }
        }
    }

    handleMouseUp() {
        this.endResize();
    }

    handleTouchEnd() {
        this.endResize();
    }

    endResize() {
        if (this.isResizing) {
            this.isResizing = false;
            this.currentHandle = null;
            this.columns = null;

            // Remove resizing class
            if (this.container) {
                this.container.classList.remove('resizing');
            }

            // Restore text selection
            document.body.style.userSelect = '';
        }
    }
}

// Initialize the resizable accordion
document.addEventListener('DOMContentLoaded', function() {
    const accordionLayout = document.getElementById('accordionLayout');
    if (accordionLayout) {
        new ResizableAccordion(accordionLayout);
    }
});

// Handle Citation highlights
document.addEventListener('DOMContentLoaded', function(e) {
    const refLinks = document.querySelectorAll('a[href^="#cite-"]');

    refLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault(); // Prevent default anchor behavior (hash change)
            e.stopPropagation(); // Stop event bubbling to avoid other handlers

            const targetId = this.getAttribute('href').substring(1); // e.g., cite-1
            const targetElement = document.getElementById(targetId);

            if (targetElement) {
                // Remove hash from URL without adding to history
                if (window.location.hash) {
                    history.replaceState(null, null, window.location.pathname);
                }

                // Remove existing highlight class
                targetElement.classList.remove('highlight');

                // Force reflow to ensure animation restarts (offsetHeight is fine)
                void targetElement.offsetHeight;

                // Add highlight class to trigger animation
                targetElement.classList.add('highlight');

                // Optional: Scroll to target
                targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            } else {
                console.warn(`Target element with ID ${targetId} not found`);
            }
        });
    });
});

// Photo Gallery
class PhotoGallery {
    constructor() {
        this.currentImageIndex = 0;
        this.imagesInFolder = [];
        this.touchStartX = 0;
        this.touchEndX = 0;
        this.isModalOpen = false;
        this.originalUrl = window.location.href; // Store original URL
        this.hasModalHistoryState = false; // Track if we've added a modal history state

        this.init();
    }

    init() {
        this.imagesInFolder = Array.from(document.querySelectorAll('.image-item'));
        this.setupEventListeners();
        this.hideHintsAfterDelay();
        this.setupBrowserHistory();
    }

    setupBrowserHistory() {
        // Store the original URL when the page loads
        this.originalUrl = window.location.href;

        // Handle browser back/forward buttons
        window.addEventListener('popstate', (event) => {
           if (this.isModalOpen) {
                // Close modal without adding history entry
                this.closeModalWithoutHistory();
                this.hasModalHistoryState = false;
            }
        });
    }

    openImageModal(imgEl) {
        const imgTag = imgEl.querySelector('img');
        const imagePath = imgEl.getAttribute('data-path');
        const fullTitle = imgEl.getAttribute('image-fullTitle');

        const modalImage = document.getElementById('modalImage');
        const imageTitle = document.getElementById('imageTitle');
        const imageModal = document.getElementById('imageModal');

        if (modalImage && imgTag) {
            this.loadImageIntoModal(imgTag.src);
            modalImage.setAttribute('data-image-name', imagePath);
            modalImage.setAttribute('image-title', fullTitle);
        }

        if (imageTitle) {
            imageTitle.textContent = fullTitle || (imgTag ? imgTag.alt : '');
        }

        if (imageModal) {
            imageModal.style.display = 'flex';
            // Trigger animation
            setTimeout(() => {
                imageModal.classList.add('show');
            }, 10);
            this.isModalOpen = true;

            // Only push history state if we haven't already
            if (!this.hasModalHistoryState) {
                history.pushState({ modalOpen: true, imageIndex: this.currentImageIndex }, '', window.location.href);
                this.hasModalHistoryState = true;
            }
        }

        this.updateNavigationButtons();
        this.showHints();
    }

    closeModal() {
        this.closeModalWithoutHistory();

        // Only go back if we actually added a history state
        if (this.hasModalHistoryState) {
            this.hasModalHistoryState = false;
            history.back();
        }
    }

    closeModalWithoutHistory() {
        const imageModal = document.getElementById('imageModal');
        if (imageModal) {
            imageModal.classList.remove('show');
            setTimeout(() => {
                imageModal.style.display = 'none';
            }, 300);
            this.isModalOpen = false;
        }
        closeCommentsWindow();
    }

    navigateImage(direction) {
        const newIndex = this.currentImageIndex + direction;

        if (newIndex >= 0 && newIndex < this.imagesInFolder.length) {
            this.currentImageIndex = newIndex;
            // When navigating between images, don't add new history states
            // Just update the current modal content
            this.updateModalContent(this.imagesInFolder[this.currentImageIndex]);
        }
    }

    updateModalContent(imgEl) {
        const imgTag = imgEl.querySelector('img');
        const imagePath = imgEl.getAttribute('data-path');
        const fullTitle = imgEl.getAttribute('image-fullTitle');

        const modalImage = document.getElementById('modalImage');
        const imageTitle = document.getElementById('imageTitle');

        if (modalImage && imgTag) {
            this.loadImageIntoModal(imgTag.src);
            modalImage.setAttribute('data-image-name', imagePath);
            modalImage.setAttribute('image-title', fullTitle);
        }

        if (imageTitle) {
            imageTitle.textContent = fullTitle || (imgTag ? imgTag.alt : '');
        }

        this.updateNavigationButtons();
        this.showHints();
    }

    loadImageIntoModal(url) {
        const modalImage = document.getElementById('modalImage');
        if (!modalImage) return;

        modalImage.classList.add('fade-out');

        setTimeout(() => {
            modalImage.onload = () => {
                modalImage.classList.remove('fade-out');
            };
            modalImage.src = url;
        }, 150);
    }

    setupEventListeners() {
        // Image gallery clicks
        this.imagesInFolder.forEach((imgEl, index) => {
            imgEl.addEventListener('click', () => {
                this.currentImageIndex = index;
                this.openImageModal(imgEl);
            });
        });

        // Folder navigation clicks
        document.querySelectorAll('.folder-item').forEach(folder => {
            folder.addEventListener('click', function() {
                const folderPath = this.getAttribute('data-path');
                // In a real implementation, this would navigate to the folder
                window.location.href = `/folder/${folderPath}`;
            });
        });

        // Navigation buttons
        const prevButton = document.getElementById('prevImage');
        const nextButton = document.getElementById('nextImage');

        if (prevButton) {
            prevButton.addEventListener('click', (e) => {
                e.stopPropagation();
                this.navigateImage(-1);
            });
        }

        if (nextButton) {
            nextButton.addEventListener('click', (e) => {
                e.stopPropagation();
                this.navigateImage(1);
            });
        }

        // Modal close events
        const modalClose = document.querySelector('.modal .close');
        if (modalClose) {
            modalClose.addEventListener('click', (e) => {
                e.stopPropagation();
                this.closeModal();
            });
        }

        // Background click to close
        const modal = document.getElementById('imageModal');
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    this.closeModal();
                }
            });
        }

        // Keyboard navigation
        document.addEventListener('keydown', (e) => {
            if (!this.isModalOpen) return;

            switch(e.key) {
                case 'Escape':
                    this.closeModal();
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    this.navigateImage(-1);
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    this.navigateImage(1);
                    break;
            }
        });

        // Touch events for swipe navigation
        const modalContent = document.querySelector('.modal-content');
        if (modalContent) {
            modalContent.addEventListener('touchstart', (e) => {
                this.touchStartX = e.changedTouches[0].screenX;
            });

            modalContent.addEventListener('touchend', (e) => {
                this.touchEndX = e.changedTouches[0].screenX;
                this.handleSwipe();
            });
        }

        // Comments button
        const commentsBtn = document.getElementById('showComments');
        if (commentsBtn) {
            commentsBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.showComments();
            });
        }
    }

    handleSwipe() {
        const swipeThreshold = 50;
        const diff = this.touchStartX - this.touchEndX;

        if (Math.abs(diff) > swipeThreshold) {
            if (diff > 0) {
                // Swiped left - next image
                this.navigateImage(1);
            } else {
                // Swiped right - previous image
                this.navigateImage(-1);
            }
        }
    }

    updateNavigationButtons() {
        const prevButton = document.getElementById('prevImage');
        const nextButton = document.getElementById('nextImage');

        if (prevButton) {
            prevButton.disabled = this.currentImageIndex === 0;
        }

        if (nextButton) {
            nextButton.disabled = this.currentImageIndex === this.imagesInFolder.length - 1;
        }
    }

    showComments() {
        // Integrated comments functionality
        const modalImage = document.getElementById('modalImage');
        if (modalImage) {
            const imageName = modalImage.getAttribute('data-image-name');
            const imageTitle = modalImage.getAttribute('image-title') || 'Unknown Image';

            // Close existing comments window if open
            if (commentsWindow && !commentsWindow.closed) {
                commentsWindow.close();
            }

            // Open server-side rendered comments modal in new window
            const url = `/comments/modal/${encodeURIComponent(imageName)}?title=${encodeURIComponent(imageTitle)}`;
            const options = 'width=900,height=700,scrollbars=yes';
            commentsWindow = window.open(url, '' , options);

            // Center the window
            if (commentsWindow) {
                const screenWidth = window.screen.availWidth;
                const screenHeight = window.screen.availHeight;
                const windowWidth = 900;
                const windowHeight = 700;
                const left = Math.max(0, (screenWidth - windowWidth) / 2);
                const top = Math.max(0, (screenHeight - windowHeight) / 2);

                commentsWindow.moveTo(left, top);
                commentsWindow.focus();
            }
        }
    }

    showHints() {
        const touchIndicator = document.querySelector('.touch-indicator');
        const keyboardHint = document.querySelector('.keyboard-hint');

        if (touchIndicator) {
            touchIndicator.classList.remove('hide');
        }
        if (keyboardHint) {
            keyboardHint.classList.remove('hide');
        }

        this.hideHintsAfterDelay();
    }

    hideHintsAfterDelay() {
        setTimeout(() => {
            const touchIndicator = document.querySelector('.touch-indicator');
            const keyboardHint = document.querySelector('.keyboard-hint');

            if (touchIndicator) {
                touchIndicator.classList.add('hide');
            }
            if (keyboardHint) {
                keyboardHint.classList.add('hide');
            }
        }, 500);
    }
}

function closeCommentsWindow() {
    if (commentsWindow && !commentsWindow.closed) {
        commentsWindow.close();
        commentsWindow = null;
    }
}

// Legacy functions kept for compatibility
function loadImageIntoModal(url) {
    const modalImage = document.getElementById('modalImage');
    if (!modalImage) return;

    modalImage.classList.add('fade-out');

    // Wait for fade-out to finish before switching the image
    setTimeout(() => {
        modalImage.onload = function () {
            // Image will automatically fit the container due to CSS
            modalImage.classList.remove('fade-out');
        };
        modalImage.src = url;
    }, 150);  // matches half the fade duration
}

function openImageModal(imgEl) {
    const imgTag = imgEl.querySelector('img');
    const imagePath = imgEl.getAttribute('data-path'); // Full relative path
    const fullTitle = imgEl.getAttribute('image-fullTitle');

    const modalImage = document.getElementById('modalImage');
    const imageTitle = document.getElementById('imageTitle');
    const imageModal = document.getElementById('imageModal');

    if (modalImage && imgTag) {
        loadImageIntoModal(imgTag.src);
        // Store the full relative path as the image name for comments
        modalImage.setAttribute('data-image-name', imagePath);
        modalImage.setAttribute('image-title', fullTitle);
    }

    if (imageTitle) {
        imageTitle.textContent = fullTitle || (imgTag ? imgTag.alt : '');
    }

    if (imageModal) {
        imageModal.style.display = 'flex';
    }
}

// Legacy AJAX functions kept as fallback
function loadComments(imageName, imageTitle) {
    if (!imageName) return;

    fetch(`/comments/${encodeURIComponent(imageName)}`)
        .then(response => response.json())
        .then(data => {
            const container = document.getElementById('comments-container');
            if (!container) return;

            const header = document.getElementById('drawer-header');
            if (header) {
                const title = "<h3>Comments - " + imageTitle + "</h3>";
                header.innerHTML = `${title}`;
            }

            if (!data.comments) {
                container.innerHTML =
                    `<p class="error">Error loading comments: ${data.error || 'Unknown error'}</p>`;
                return;
            }
            if (data.comments.length === 0) {
                container.innerHTML =
                    `<p class="no-comments">No comments yet. Be the first!</p>`;
            } else {
                container.innerHTML = data.comments.map(
                   c => `<div class="comment">
                        <div class="comment-header">
                            <span class="comment-author">${c.author}</span>
                            <span class="comment-date">${formatDate(c.created)}</span>
                        </div>
                        <div class="comment-text">${c.comment}</div>
                    </div>`
                ).join('');
            }
        })
        .catch(error => {
            console.error('Error loading comments:', error);
            const container = document.getElementById('comments-container');
            if (container) {
                container.innerHTML =
                    `<p class="error">Error loading comments. Please try again.</p>`;
            }
        });
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
}

// Legacy drawer functions (kept for compatibility)
function closeDrawer() {
    closeCommentsWindow();
}
