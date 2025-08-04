/* static/js/contact.js */
document.addEventListener('DOMContentLoaded', () => {
    // Check if we're on the contact page before trying to access contact form
    const contactForm = document.getElementById('contactForm');
    if (!contactForm) {
        return; // Exit early if contact form doesn't exist
    }

    contactForm.addEventListener('submit', function(e) {
        e.preventDefault();

        // Get form data
        const formData = new FormData(this);
        const data = {};

        // Convert FormData to object, handling checkboxes properly
        for (let [key, value] of formData.entries()) {
            data[key] = value;
        }

        // Simple validation
        if (!data.firstName || !data.lastName || !data.email || !data.subject || !data.message) {
            alert('Please fill in all required fields.');
            return;
        }

        if (!data.privacy) {
            alert('Please agree to the Privacy Policy and Terms of Service.');
            return;
        }

        // Email validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(data.email)) {
            alert('Please enter a valid email address.');
            return;
        }

        // Get submit button
        const submitBtn = document.querySelector('.submit-btn');
        const originalText = submitBtn.textContent;
        submitBtn.textContent = 'Sending...';
        submitBtn.disabled = true;

         // Send the data to Flask using fetch
        fetch('/contactpage', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(result => {
            if (result.success) {
                alert('Thank you! Your message has been sent successfully.');
                document.getElementById('contactForm').reset();
                // Hide conditional fields
                const imageField = document.getElementById('imageField');
                const companyField = document.getElementById('companyField');
                if (imageField) imageField.style.display = 'none';
                if (companyField) companyField.style.display = 'none';
            } else {
                alert(result.message || 'There was an error sending your message.');
            }
        })
        .catch(error => {
            console.error('Error:', error);
            alert('There was an error sending your message. Please try again.');
        })
        .finally(() => {
            submitBtn.textContent = originalText;
            submitBtn.disabled = false;
        });
    });

    // Add smooth animations to form elements
    const inputs = document.querySelectorAll('input, select, textarea');
    inputs.forEach(input => {
        input.addEventListener('focus', function() {
            this.parentElement.style.transform = 'scale(1.02)';
        });

        input.addEventListener('blur', function() {
            this.parentElement.style.transform = 'scale(1)';
        });
    });

    // Handle subject field changes
    const subjectSelect = document.getElementById('subject');
    const imageField = document.getElementById('imageField');
    const companyField = document.getElementById('companyField');

    if (subjectSelect && imageField && companyField) {
        subjectSelect.addEventListener('change', function () {
            // Reset both fields
            imageField.style.display = 'none';
            companyField.style.display = 'none';
            const imageInput = document.getElementById('image');
            const companyInput = document.getElementById('company');
            if (imageInput) imageInput.value = '';
            if (companyInput) companyInput.value = '';

            // Show appropriate field based on selection
            if (this.value === 'purchase') {
                imageField.style.display = 'block';
            } else if (this.value === 'partnership') {
                companyField.style.display = 'block';
            }
        });

        // On page load, enforce the rule
        subjectSelect.dispatchEvent(new Event('change'));
    }
});
