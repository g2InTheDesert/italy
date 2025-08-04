/* static/js/blog.js */
class BlogManager {
    constructor() {
        this.drawer = document.getElementById("blog-drawer");
        this.drawerTitle = document.getElementById("drawer-title");
        this.drawerContent = document.getElementById("drawer-content");
        this.drawerClose = document.getElementById("drawer-close");
        this.filterForm = document.getElementById("filter-form");
        this.blogGrid = document.getElementById("blog-grid");
        this.errorContainer = document.getElementById("error-container");
        this.sortSelect = document.getElementById("sort-select");

        this.debounceTimer = null;
        this.isLoading = false;
        this.currentPost = null;
        this.isSSRFallbackEnabled = true;
        this.originalMetaTags = {};
        this.originalTitle = document.title;

        this.init();
    }

    init() {
        this.storeOriginalMetaTags();
        this.attachEventListeners();
        this.setupKeyboardNavigation();
        this.setupIntersectionObserver();
        this.handleInitialURL();
    }

    storeOriginalMetaTags() {
        // Store original meta tags for restoration
        const metaSelectors = [
            'meta[property="og:title"]',
            'meta[property="og:description"]',
            'meta[property="og:image"]',
            'meta[property="og:url"]',
            'meta[property="og:type"]',
            'meta[name="twitter:title"]',
            'meta[name="twitter:description"]',
            'meta[name="twitter:image"]',
            'meta[name="description"]',
            'link[rel="canonical"]'
        ];

        metaSelectors.forEach(selector => {
            const element = document.querySelector(selector);
            if (element) {
                this.originalMetaTags[selector] = element.getAttribute('content') || element.getAttribute('href');
            }
        });
    }

    async handleInitialURL() {
        // Check if URL contains a post slug for direct linking
        const pathParts = window.location.pathname.split('/');
        const postSlug = pathParts[pathParts.length - 1];

        // If we're on a specific post URL, try client-side first, then fallback to SSR
        if (postSlug && postSlug !== 'blog' && window.location.pathname.includes('/blog/')) {
            const success = await this.openDrawerBySlug(postSlug);

            // If client-side fails and this is a direct navigation, fallback to server rendering
            if (!success && !document.referrer.includes(window.location.origin)) {
                this.fallbackToServerRender(postSlug);
            }
        }
    }

    attachEventListeners() {
        // Form submission with AJAX fallback
        if (this.filterForm) {
            this.filterForm.addEventListener("submit", (e) => this.handleFormSubmit(e));
        }

        // Real-time search with debouncing
        const searchInput = document.getElementById("search");
        if (searchInput) {
            searchInput.addEventListener("input", (e) => {
                clearTimeout(this.debounceTimer);
                this.debounceTimer = setTimeout(() => {
                    this.handleRealTimeSearch(e.target.value);
                }, 300);
            });
        }

        // Sort change handler
        if (this.sortSelect) {
            this.sortSelect.addEventListener("change", () => {
                this.submitFormWithAjax();
            });
        }

        // Blog post click handlers
        this.attachPostClickHandlers();

        // Drawer event listeners
        this.setupDrawerHandlers();

        // Handle browser back/forward
        window.addEventListener("popstate", (e) => {
            if (e.state) {
                if (e.state.postId) {
                    // Navigating to a specific post
                    this.openDrawer(e.state.postId, false);
                } else if (e.state.blogFilters) {
                    // Navigating with filters
                    this.closeDrawer(false);
                    this.updateFormFromState(e.state.blogFilters);
                    this.loadPosts(false);
                } else {
                    // Navigating back to main blog
                    this.closeDrawer(false);
                }
            } else {
                // No state, probably initial page load or back to main blog
                this.closeDrawer(false);
            }
        });
    }

    attachPostClickHandlers() {
        const blogPosts = document.querySelectorAll(".blog-post");
        blogPosts.forEach(post => {
            post.addEventListener("click", (e) => {
                if (!e.target.closest('a')) { // Prevent if clicking on links
                    const postId = post.dataset.postId;
                    this.openDrawer(postId);
                }
            });

            // Keyboard accessibility
            post.addEventListener("keydown", (e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    const postId = post.dataset.postId;
                    this.openDrawer(postId);
                }
            });
        });
    }

    setupDrawerHandlers() {
        // Close drawer handlers
        if (this.drawerClose) {
            this.drawerClose.addEventListener("click", () => {
                this.closeDrawer();
            });
        }

        // Close on outside click
        document.addEventListener("click", (e) => {
            if (this.drawer &&
                this.drawer.classList.contains("open") &&
                !this.drawer.querySelector('.drawer-content').contains(e.target) &&
                !e.target.closest(".blog-post")) {
                this.closeDrawer();
            }
        });

        // Close on Escape key
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && this.drawer && this.drawer.classList.contains("open")) {
                this.closeDrawer();
            }
        });
    }

    setupKeyboardNavigation() {
        // Tab navigation for blog posts
        const blogPosts = document.querySelectorAll(".blog-post");
        blogPosts.forEach((post, index) => {
            post.addEventListener("keydown", (e) => {
                if (e.key === "ArrowDown" && index < blogPosts.length - 1) {
                    e.preventDefault();
                    blogPosts[index + 1].focus();
                } else if (e.key === "ArrowUp" && index > 0) {
                    e.preventDefault();
                    blogPosts[index - 1].focus();
                }
            });
        });
    }

    setupIntersectionObserver() {
        // Lazy loading for images
        const images = document.querySelectorAll('img[loading="lazy"]');
        if ('IntersectionObserver' in window) {
            const imageObserver = new IntersectionObserver((entries, observer) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const img = entry.target;
                        img.src = img.src; // Trigger loading
                        observer.unobserve(img);
                    }
                });
            });

            images.forEach(img => imageObserver.observe(img));
        }
    }

    async handleFormSubmit(e) {
        e.preventDefault();

        // Try AJAX first
        const success = await this.submitFormWithAjax();

        // Fallback to regular form submission if AJAX fails
        if (!success) {
            console.log("AJAX failed, falling back to form submission");
            this.filterForm.submit();
        }
    }

    async submitFormWithAjax() {
        if (this.isLoading) return false;

        try {
            this.setLoading(true);
            const formData = new FormData(this.filterForm);
            const params = new URLSearchParams();

            // Build query parameters
            for (let [key, value] of formData.entries()) {
                if (value.trim()) {
                    params.append(key, value.trim());
                }
            }

            // Make AJAX request
            const response = await fetch(`${window.location.pathname}?${params.toString()}`, {
                method: 'GET',
                headers: {
                    'X-Requested-With': 'XMLHttpRequest',
                    'Accept': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();

            if (data.success) {
                this.updatePageContent(data);
                this.updateURL(params);
                this.hideError();
                return true;
            } else {
                throw new Error(data.error || 'Unknown error occurred');
            }

        } catch (error) {
            console.error('AJAX request failed:', error);
            this.showError('Failed to load posts. Refreshing page...');

            // Fallback: redirect after short delay
            setTimeout(() => {
                const params = new URLSearchParams(new FormData(this.filterForm));
                const newUrl = params.toString() ?
                    `${window.location.pathname}?${params.toString()}` :
                    window.location.pathname;
                window.location.href = newUrl;
            }, 1500);

            return false;
        } finally {
            this.setLoading(false);
        }
    }

    async handleRealTimeSearch(searchTerm) {
        if (this.isLoading) return;

        // Update the search input value
        const searchInput = document.getElementById("search");
        searchInput.value = searchTerm;

        // Submit the form
        await this.submitFormWithAjax();
    }

    fallbackToServerRender(slug) {
        // If AJAX fails for direct navigation, redirect to server-rendered version
        if (this.isSSRFallbackEnabled) {
            console.log('Falling back to server-side rendering for:', slug);
            window.location.href = `/blog/${slug}?ssr=1`;
        }
    }

    updatePageContent(data) {
        // Update blog grid
        this.updateBlogGrid(data.posts);

        // Update pagination
        this.updatePagination(data.pagination);

        // Update results info
        this.updateResultsInfo(data.total_posts, data.filters);

        // Re-attach event listeners to new posts
        this.attachPostClickHandlers();

        // Scroll to top of results
        this.blogGrid.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    updateBlogGrid(posts) {
        if (!posts || posts.length === 0) {
            this.blogGrid.innerHTML = `
                <div class="empty-state">
                    <h3>No posts match your filters</h3>
                    <p>Try adjusting your search criteria or clearing some filters.</p>
                    <button type="button" class="btn btn-primary" onclick="resetFilters()">
                        Clear All Filters
                    </button>
                </div>
            `;
            return;
        }

        this.blogGrid.innerHTML = posts.map(post => `
            <article class="blog-post"
                     data-post-id="${post.id}"
                     data-post-slug="${post.slug || post.id}"
                     role="button"
                     tabindex="0"
                     aria-label="Read full post: ${this.escapeHtml(post.title)}">
                <div class="post-content">
                    <h2>${this.escapeHtml(post.title)}</h2>
                    <div class="post-meta">
                        <span class="post-meta-item">
                            <time datetime="${post.date}">${post.date}</time>
                        </span>
                        <span class="post-meta-item">
                            By ${this.escapeHtml(post.author)}
                        </span>
                        ${post.category ? `<span class="post-meta-item">in ${this.escapeHtml(post.category)}</span>` : ''}
                    </div>
                    <div class="post-excerpt">${this.escapeHtml(post.excerpt)}</div>
                    <div class="post-tags">
                        ${post.category ? `<span class="post-tag">${this.escapeHtml(post.category)}</span>` : ''}
                        ${post.province ? `<span class="post-tag">${this.escapeHtml(post.province)}</span>` : ''}
                        ${post.city ? `<span class="post-tag">${this.escapeHtml(post.city)}</span>` : ''}
                    </div>
                </div>
                <img src="${post.image}"
                     onerror="this.src='/static/img/placeholder.jpg'"
                     class="blog-post-image"
                     alt="${this.escapeHtml(post.title)}"
                     loading="lazy">
            </article>
        `).join('');
    }

    updatePagination(pagination) {
        const paginationContainer = document.getElementById("pagination");
        if (!paginationContainer) return;

        if (!pagination.pages || pagination.pages.length === 0) {
            paginationContainer.innerHTML = '';
            return;
        }

        let paginationHTML = '<nav role="navigation" aria-label="Blog pagination">';

        // Previous button
        if (pagination.show_prev) {
            paginationHTML += `
                <a href="${pagination.prev_url}"
                   class="pagination-nav"
                   aria-label="Go to previous page">
                    ← Previous
                </a>
            `;
        }

        // Page numbers
        pagination.pages.forEach(pageInfo => {
            if (pageInfo.ellipsis) {
                paginationHTML += '<span class="ellipsis" aria-hidden="true">…</span>';
            } else {
                paginationHTML += `
                    <a href="${pageInfo.url}"
                       ${pageInfo.is_current ? 'class="active" aria-current="page"' : ''}
                       aria-label="Go to page ${pageInfo.number}">
                        ${pageInfo.number}
                    </a>
                `;
            }
        });

        // Next button
        if (pagination.show_next) {
            paginationHTML += `
                <a href="${pagination.next_url}"
                   class="pagination-nav"
                   aria-label="Go to next page">
                    Next →
                </a>
            `;
        }

        paginationHTML += '</nav>';
        paginationContainer.innerHTML = paginationHTML;

        // Add click handlers for pagination links
        paginationContainer.querySelectorAll('a').forEach(link => {
            link.addEventListener('click', async (e) => {
                e.preventDefault();
                const url = new URL(link.href);

                // Update form with new page and submit
                const pageParam = url.searchParams.get('page');
                if (pageParam) {
                    // Update form data and submit
                    const formData = new FormData(this.filterForm);
                    formData.set('page', pageParam);

                    // Create new form with page parameter
                    const params = new URLSearchParams();
                    for (let [key, value] of formData.entries()) {
                        if (value.trim()) {
                            params.append(key, value.trim());
                        }
                    }
                    params.set('page', pageParam);

                    // Make AJAX request for pagination
                    await this.loadPostsWithParams(params);
                }
            });
        });
    }

    updateResultsInfo(totalPosts, filters) {
        const resultsInfo = document.querySelector('.results-info .results-count');
        if (!resultsInfo) return;

        let resultText = '';
        if (totalPosts === 0) {
            resultText = 'No posts found';
        } else if (totalPosts === 1) {
            resultText = '1 post found';
        } else {
            resultText = `${totalPosts} posts found`;
        }

        // Add active filters info
        const activeFilters = [];
        if (filters.search_query) activeFilters.push(`Search: "${filters.search_query}"`);
        if (filters.category_filter) activeFilters.push(`Category: ${filters.category_filter}`);
        if (filters.province_filter) activeFilters.push(`Province: ${filters.province_filter}`);
        if (filters.city_filter) activeFilters.push(`City: ${filters.city_filter}`);
        if (filters.author_filter) activeFilters.push(`Author: ${filters.author_filter}`);

        if (activeFilters.length > 0) {
            resultText += ` - Filtered by: ${activeFilters.join(', ')}`;
        }

        resultsInfo.textContent = resultText;
    }

    async loadPostsWithParams(params) {
        try {
            this.setLoading(true);

            const response = await fetch(`${window.location.pathname}?${params.toString()}`, {
                method: 'GET',
                headers: {
                    'X-Requested-With': 'XMLHttpRequest',
                    'Accept': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();

            if (data.success) {
                this.updatePageContent(data);
                this.updateURL(params);
                this.hideError();
            } else {
                throw new Error(data.error || 'Unknown error occurred');
            }

        } catch (error) {
            console.error('Failed to load posts:', error);
            this.showError('Failed to load posts. Please try again.');
        } finally {
            this.setLoading(false);
        }
    }

    updateURL(params) {
        const newUrl = params.toString() ?
            `${window.location.pathname}?${params.toString()}` :
            window.location.pathname;

        // Push to history for back button support
        const state = {
            blogFilters: Object.fromEntries(params.entries())
        };

        history.pushState(state, '', newUrl);
    }

    updateFormFromState(filters) {
        // Update form fields from history state
        Object.entries(filters).forEach(([key, value]) => {
            const field = this.filterForm.querySelector(`[name="${key}"]`);
            if (field) {
                field.value = value;
            }
        });
    }

async openDrawer(postId, updateHistory = true) {
    if (!this.drawer) return;

    try {
        this.setDrawerLoading(true);

        const response = await fetch(`/blog/post/${postId}`, {
            method: 'GET',
            headers: {
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }

        const data = await response.json();

        // Simple: if there's an error property, it failed
        if (data.error) {
            throw new Error(data.error);
        }

        // Otherwise, assume the data IS the post data
        this.openDrawerWithData(data, updateHistory);

    } catch (error) {
        console.error('Error fetching post:', error);
        this.drawerTitle.textContent = 'Error';
        this.drawerContent.innerHTML = '<p>Error loading post. Please try again.</p>';
        this.showDrawer();
    } finally {
        this.setDrawerLoading(false);
    }
}

async openDrawerBySlug(slug) {
    try {
        // First try to find post in current page
        const post = document.querySelector(`[data-post-slug="${slug}"]`);
        if (post) {
            const postId = post.dataset.postId;
            await this.openDrawer(postId, false);
            return true;
        }

        // If not found, try to fetch via AJAX (assuming you have a slug endpoint)
        const response = await fetch(`/blog/post/slug/${slug}`, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'X-Requested-With': 'XMLHttpRequest'
            }
        });

        if (response.ok) {
            const data = await response.json();

            if (data.error) {
                return false;
            }

            this.openDrawerWithData(data, false);
            return true;
        }

        return false;
    } catch (error) {
        console.error('Error fetching post by slug:', error);
        return false;
    }
}

// Debug method - add this temporarily to see what's happening
debugDrawerData(data) {
    console.log('=== DRAWER DEBUG ===');
    console.log('Data received:', data);
    console.log('Data type:', typeof data);
    console.log('Data keys:', Object.keys(data));
    console.log('Title:', data.title);
    console.log('Content preview:', data.content ? data.content.substring(0, 100) + '...' : 'NO CONTENT');
    console.log('==================');
}

// Modified openDrawerWithData to include debugging
openDrawerWithData(data, updateHistory = true) {
    // Add debug call
    this.debugDrawerData(data);

    this.currentPost = data;

    // Update drawer title
    this.drawerTitle.textContent = data.title || 'No Title';

    // Calculate reading time
    const readingTime = this.calculateReadingTime(data.content || '');

    // Create breadcrumb
    const breadcrumb = this.createBreadcrumb(data);

    // Update content with enhanced semantic markup
    this.drawerContent.innerHTML = `
        <article itemscope itemtype="http://schema.org/BlogPosting">
            <div class="drawer-post-header" class="drawer-meta">
                <time datetime="${data.date || ''}" itemprop="datePublished">${data.date || 'No Date'}</time>
                <span itemprop="author" itemscope itemtype="http://schema.org/Person">
                    By <span itemprop="name">${this.escapeHtml(data.author || 'Unknown')}</span>
                </span>
                ${data.category ? `<span>in <span itemprop="articleSection">${this.escapeHtml(data.category)}</span></span>` : ''}
                <span class="reading-time">${readingTime} min read</span>
            </div>

            <div class="drawer-image-container" itemprop="image" itemscope itemtype="http://schema.org/ImageObject">
                <img src="${data.image_url || '/static/img/placeholder.jpg'}"
                     onerror="this.src='/static/img/placeholder.jpg'"
                     alt="${this.escapeHtml(data.title || '')}"
                     class="drawer-image"
                     itemprop="url">
                <meta itemprop="width" content="800">
                <meta itemprop="height" content="400">
            </div>

            <main class="drawer-text" itemprop="articleBody">
                ${data.content || '<p>No content available.</p>'}
            </main>

            <footer class="drawer-post-footer">
                <div class="post-tags">
                    ${data.category ? `<span class="post-tag" itemprop="keywords">${this.escapeHtml(data.category)}</span>` : ''}
                    ${data.province ? `<span class="post-tag" itemprop="keywords">${this.escapeHtml(data.province)}</span>` : ''}
                    ${data.city ? `<span class="post-tag" itemprop="keywords">${this.escapeHtml(data.city)}</span>` : ''}
                </div>

                <div class="social-sharing">
                    <span>Share this post:</span>
                    ${this.createSocialButtons(data)}
                </div>
            </footer>

            <!-- JSON-LD Structured Data -->
            <script type="application/ld+json">
            ${this.generateStructuredData(data)}
            </script>
        </article>
    `;

    // Update SEO meta tags
    this.updateMetaTags(data);

    // Update URL and history
    if (updateHistory) {
        const postUrl = `/blog/${data.slug || data.id}`;
        const state = { postId: data.id, postData: data };
        history.pushState(state, data.title || 'Blog Post', postUrl);
    }

    this.showDrawer();
}

    createBreadcrumb(data) {
        return `
            <nav class="breadcrumb" aria-label="Breadcrumb">
                <ol itemscope itemtype="http://schema.org/BreadcrumbList">
                    <li itemprop="itemListElement" itemscope itemtype="http://schema.org/ListItem">
                        <a itemprop="item" href="/blog">
                            <span itemprop="name">Blog</span>
                        </a>
                        <meta itemprop="position" content="1" />
                    </li>
                    ${data.category ? `
                    <li itemprop="itemListElement" itemscope itemtype="http://schema.org/ListItem">
                        <span itemprop="name">${this.escapeHtml(data.category)}</span>
                        <meta itemprop="position" content="2" />
                    </li>
                    ` : ''}
                    <li itemprop="itemListElement" itemscope itemtype="http://schema.org/ListItem">
                        <span itemprop="name" aria-current="page">${this.escapeHtml(data.title)}</span>
                        <meta itemprop="position" content="${data.category ? '3' : '2'}" />
                    </li>
                </ol>
            </nav>
        `;
    }

    createSocialButtons(data) {
        const url = encodeURIComponent(window.location.href);
        const title = encodeURIComponent(data.title);
        const description = encodeURIComponent(data.excerpt || '');

        return `
            <a href="https://twitter.com/intent/tweet?url=${url}&text=${title}"
               target="_blank" rel="noopener" aria-label="Share on Twitter">
                Twitter
            </a>&nbsp;
            <a href="https://www.facebook.com/sharer/sharer.php?u=${url}"
               target="_blank" rel="noopener" aria-label="Share on Facebook">
                Facebook
            </a>&nbsp;
            <a href="https://www.linkedin.com/sharing/share-offsite/?url=${url}"
               target="_blank" rel="noopener" aria-label="Share on LinkedIn">
                LinkedIn
            </a>&nbsp;
            <button onclick="navigator.share ? navigator.share({title: '${title.replace(/'/g, "\\'")}', url: '${url}'}) : navigator.clipboard.writeText('${url}')"
                    aria-label="Share or copy link">
                Share
            </button>
        `;
    }

    calculateReadingTime(content) {
        const wordsPerMinute = 200;
        const textContent = content.replace(/<[^>]*>/g, '');
        const wordCount = textContent.split(/\s+/).length;
        return Math.ceil(wordCount / wordsPerMinute);
    }

    generateStructuredData(data) {
        const structuredData = {
            "@context": "http://schema.org",
            "@type": "BlogPosting",
            "headline": data.title,
            "description": data.excerpt || "",
            "image": {
                "@type": "ImageObject",
                "url": data.image_url || "/static/img/placeholder.jpg",
                "width": 800,
                "height": 400
            },
            "author": {
                "@type": "Person",
                "name": data.author
            },
            "publisher": {
                "@type": "Organization",
                "name": "Your Site Name",
                "logo": {
                    "@type": "ImageObject",
                    "url": "/static/img/logo.png"
                }
            },
            "datePublished": data.date,
            "dateModified": data.modified_date || data.date,
            "mainEntityOfPage": {
                "@type": "WebPage",
                "@id": window.location.href
            },
            "articleSection": data.category || "",
            "keywords": [data.category, data.province, data.city].filter(Boolean).join(", "),
            "wordCount": this.calculateReadingTime(data.content) * 200,
            "timeRequired": `PT${this.calculateReadingTime(data.content)}M`
        };

        return JSON.stringify(structuredData, null, 2);
    }

    updateMetaTags(data) {
        // Keep all your existing updateMetaTags code...

        // Update page title
        document.title = `${data.title} | ${this.originalTitle}`;

        // Update or create meta tags
        this.updateOrCreateMetaTag('meta[name="description"]', 'content', data.excerpt || '');
        this.updateOrCreateMetaTag('meta[property="og:title"]', 'content', data.title);
        this.updateOrCreateMetaTag('meta[property="og:description"]', 'content', data.excerpt || '');
        this.updateOrCreateMetaTag('meta[property="og:image"]', 'content', data.image_url || '/static/img/placeholder.jpg');
        this.updateOrCreateMetaTag('meta[property="og:url"]', 'content', window.location.href);
        this.updateOrCreateMetaTag('meta[property="og:type"]', 'content', 'article');
        this.updateOrCreateMetaTag('meta[name="twitter:title"]', 'content', data.title);
        this.updateOrCreateMetaTag('meta[name="twitter:description"]', 'content', data.excerpt || '');
        this.updateOrCreateMetaTag('meta[name="twitter:image"]', 'content', data.image_url || '/static/img/placeholder.jpg');

        // Update canonical URL
        this.updateOrCreateMetaTag('link[rel="canonical"]', 'href', window.location.href);

        // Add article-specific meta tags
        this.updateOrCreateMetaTag('meta[property="article:author"]', 'content', data.author);
        this.updateOrCreateMetaTag('meta[property="article:published_time"]', 'content', data.date);
        if (data.category) {
            this.updateOrCreateMetaTag('meta[property="article:section"]', 'content', data.category);
        }

        // ADD THESE NEW ENHANCEMENTS:
        // Add JSON-LD structured data to head for better SEO
        this.addStructuredDataToHead(data);

        // Preload next/previous posts for better performance
        this.preloadAdjacentPosts(data);
    }

    updateOrCreateMetaTag(selector, attribute, value) {
        let element = document.querySelector(selector);
        if (!element) {
            element = document.createElement(selector.includes('link') ? 'link' : 'meta');
            const matches = selector.match(/\[(.*?)\]/g);
            matches.forEach(match => {
                const [attr, val] = match.slice(1, -1).split('=');
                element.setAttribute(attr, val.replace(/"/g, ''));
            });
            document.head.appendChild(element);
        }
        element.setAttribute(attribute, value);
    }

    restoreOriginalMetaTags() {
        // Restore original page title
        document.title = this.originalTitle;

        // Restore original meta tags
        Object.entries(this.originalMetaTags).forEach(([selector, value]) => {
            const element = document.querySelector(selector);
            if (element && value) {
                const attribute = selector.includes('link') ? 'href' : 'content';
                element.setAttribute(attribute, value);
            }
        });

        // Remove article-specific meta tags
        const articleTags = [
            'meta[property="article:author"]',
            'meta[property="article:published_time"]',
            'meta[property="article:section"]'
        ];

        articleTags.forEach(selector => {
            const element = document.querySelector(selector);
            if (element) {
                element.remove();
            }
        });
    }

    addStructuredDataToHead(data) {
        // Remove existing structured data
        const existingLD = document.querySelector('script[type="application/ld+json"][data-blog-post]');
        if (existingLD) {
            existingLD.remove();
        }

        // Add new structured data to head
        const script = document.createElement('script');
        script.type = 'application/ld+json';
        script.setAttribute('data-blog-post', 'true');
        script.textContent = this.generateStructuredData(data);
        document.head.appendChild(script);
    }

    preloadAdjacentPosts(data) {
        // Preload next/previous posts if available
        if (data.next_post_slug) {
            const nextLink = document.createElement('link');
            nextLink.rel = 'prefetch';
            nextLink.href = `/blog/post/${data.next_post_slug}`;
            document.head.appendChild(nextLink);
        }

        if (data.prev_post_slug) {
            const prevLink = document.createElement('link');
            prevLink.rel = 'prefetch';
            prevLink.href = `/blog/post/${data.prev_post_slug}`;
            document.head.appendChild(prevLink);
        }
    }

    // Add support for server-side rendered posts
    setupServerRenderedPost() {
        // If page already contains a server-rendered post, set it up properly
        const serverPost = document.querySelector('.server-rendered-post');
        if (serverPost) {
            const postData = JSON.parse(serverPost.dataset.postData || '{}');
            this.currentPost = postData;
            this.updateMetaTags(postData);

            // Convert server-rendered post to drawer format
            this.convertServerPostToDrawer(serverPost, postData);
        }
    }

    convertServerPostToDrawer(serverPost, postData) {
        // Hide server-rendered content and show in drawer instead
        serverPost.style.display = 'none';
        this.openDrawerWithData(postData, false);

        // Update URL without the ?ssr=1 parameter
        const cleanUrl = window.location.href.replace(/[?&]ssr=1/, '').replace(/\?$/, '');
        history.replaceState({ postId: postData.id, postData }, postData.title, cleanUrl);
    }

    showDrawer() {
        if (!this.drawer) return;

        this.drawer.classList.add("open");
        this.drawer.setAttribute("aria-hidden", "false");

        // Focus management for accessibility
        if (this.drawerClose) {
            this.drawerClose.focus();
        }

        // Prevent body scrolling
        document.body.style.overflow = 'hidden';
    }

closeDrawer(updateHistory = true) {
    if (!this.drawer) return;

    this.drawer.classList.remove("open");
    this.drawer.setAttribute("aria-hidden", "true");

    // Restore original meta tags
    this.restoreOriginalMetaTags();

    // Restore body scrolling
    document.body.style.overflow = '';

    // Return focus to the post that was clicked
    const activePost = document.querySelector('.blog-post:focus');
    if (activePost) {
        activePost.focus();
    }

    // Update URL and history - FIXED VERSION
    if (updateHistory) {
        // Instead of manipulating the URL directly, go back in history
        // This simulates the user pressing the back button
        history.back();
    }

    // Clear current post
    this.currentPost = null;

    // Remove any structured data scripts added by the drawer
    const existingScripts = document.querySelectorAll('script[type="application/ld+json"]');
    existingScripts.forEach(script => {
        if (script.closest('.drawer-content')) {
            script.remove();
        }
    });
}

    setLoading(loading) {
        this.isLoading = loading;
        const applyButton = document.getElementById("apply-filters");

        if (loading) {
            this.blogGrid.classList.add("loading");
            if (applyButton) {
                applyButton.disabled = true;
                applyButton.innerHTML = '<span>Loading...</span>';
            }
        } else {
            this.blogGrid.classList.remove("loading");
            if (applyButton) {
                applyButton.disabled = false;
                applyButton.innerHTML = '<span>Apply Filters</span>';
            }
        }
    }

    setDrawerLoading(loading) {
        if (loading) {
            this.drawerContent.innerHTML = '<div class="loading-spinner">Loading...</div>';
        }
    }

    // Add missing utility methods
    escapeHtml(text) {
        if (!text) return '';
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return text.replace(/[&<>"']/g, function(m) { return map[m]; });
    }

    showError(message) {
        if (this.errorContainer) {
            this.errorContainer.textContent = message;
            this.errorContainer.style.display = 'block';
        } else {
            console.error(message);
        }
    }

    hideError() {
        if (this.errorContainer) {
            this.errorContainer.style.display = 'none';
        }
    }
}

// Initialize the BlogManager when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    // Check if this is a server-rendered post page
    const isPostPage = window.location.pathname.match(/\/blog\/[^\/]+$/);

    window.blogManager = new BlogManager();

    // If this is a post page, check for server-rendered content
    if (isPostPage) {
        window.blogManager.setupServerRenderedPost();
    }
});

// Add the resetFilters function that's called from the HTML
function resetFilters() {
    const form = document.getElementById('filter-form');
    if (form) {
        form.reset();
        // Trigger form submission to refresh results
        if (window.blogManager) {
            window.blogManager.submitFormWithAjax();
        } else {
            form.submit();
        }
    }
}
