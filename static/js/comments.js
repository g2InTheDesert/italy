/* static/js/comments.js */
// Close modal when clicking outside
document.addEventListener('click', function(event) {
    if (event.target === document.body) {
        window.close();
    }
});

// Close modal with Escape key
document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
        window.close();
    }
});

// AJAX fallback functionality
function enableAjaxFallback() {
    const serverForm = document.getElementById('commentForm');
    const ajaxForm = document.getElementById('ajaxCommentForm');
    
    if (serverForm && ajaxForm) {
        serverForm.style.display = 'none';
        ajaxForm.style.display = 'block';
        
        ajaxForm.addEventListener('submit', function(e) {
            e.preventDefault();
            const formData = new FormData(this);
            
            fetch('/comments', {
                method: 'POST',
                body: formData
            })
            .then(async res => {
                if (!res.ok) {
                    const text = await res.text();
                    throw new Error("Server error: " + text);
                }
                return res.json();
            })
            .then(result => {
                if (result.success) {
                    // Refresh the page to show new comment
                    window.location.reload();
                } else {
                    alert('Failed to submit comment');
                }
            })
            .catch(err => {
                console.error('Error adding comment:', err);
                alert('Error adding comment. Please try again.');
            });
        });
    }
}

// Check if server-side form submission failed and enable AJAX fallback
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.has('ajax_fallback')) {
    enableAjaxFallback();
}

// Auto-close success message after form submission
if (urlParams.has('success')) {
    setTimeout(() => {
        const successMsg = document.querySelector('.success-message');
        if (successMsg) {
            successMsg.style.display = 'none';
        }
    }, 3000);
}
